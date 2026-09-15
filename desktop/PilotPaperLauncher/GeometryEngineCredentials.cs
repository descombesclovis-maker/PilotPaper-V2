using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PilotPaperLauncher;

internal sealed record GeometryEngineSession(string Token, int OrgId, int UserId);

internal static class GeometryEngineCredentials
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PilotPaper-V2-GeometryEngine-v1");
    private static readonly Regex OrgUrlRegex = new(@"/api/orgs/(\d+)/?", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex UserUrlRegex = new(@"/auth/users/(\d+)/?", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private sealed record StoredCredential(string Token, int OrgId, int UserId, int SchemaVersion = 2);

    private static string CredentialPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PilotPaper",
        "V2",
        "geometry-engine.bin");

    internal static async Task<GeometryEngineSession?> EnsureAsync(Form owner, Action<string> log)
    {
        var stored = TryLoad(log);
        if (stored is not null) return stored;

        while (true)
        {
            var token = PromptForToken(owner);
            if (string.IsNullOrWhiteSpace(token))
            {
                log("Geometry engine setup skipped; fallback remains active.");
                return null;
            }

            try
            {
                var session = await EstablishSessionAsync(token.Trim(), log);
                Save(session);
                MessageBox.Show(
                    owner,
                    "Connexion enregistrée. Le moteur géométrique est prêt et cette clé ne vous sera plus demandée sur ce compte Windows.",
                    "PilotPaper V2",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return session;
            }
            catch (Exception ex)
            {
                log($"Geometry engine setup failed: {ex.Message}");
                var retry = MessageBox.Show(
                    owner,
                    $"La connexion n'a pas pu être validée.\n\n{ex.Message}\n\nVoulez-vous saisir le token à nouveau ?",
                    "PilotPaper V2",
                    MessageBoxButtons.RetryCancel,
                    MessageBoxIcon.Warning);
                if (retry != DialogResult.Retry) return null;
            }
        }
    }

    internal static GeometryEngineSession? TryLoad(Action<string> log)
    {
        try
        {
            if (!File.Exists(CredentialPath)) return null;

            var encrypted = File.ReadAllBytes(CredentialPath);
            var plain = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
            try
            {
                var stored = JsonSerializer.Deserialize<StoredCredential>(plain);
                if (stored is null || string.IsNullOrWhiteSpace(stored.Token) || stored.OrgId < 1)
                {
                    log("Geometry engine protected credential is incomplete; requesting a new token.");
                    return null;
                }
                return new GeometryEngineSession(stored.Token, stored.OrgId, stored.UserId);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plain);
            }
        }
        catch (Exception ex)
        {
            log($"Geometry engine protected credential could not be read: {ex.Message}");
            return null;
        }
    }

    private static string? PromptForToken(IWin32Window owner)
    {
        using var form = new Form
        {
            Text = "PilotPaper V2 — Moteur géométrique",
            Width = 610,
            Height = 265,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };

        var label = new Label
        {
            Left = 22,
            Top = 20,
            Width = 550,
            Height = 62,
            Text = "Collez votre token de connexion. Il sera validé puis chiffré par Windows. Il ne sera ni affiché dans PilotPaper, ni enregistré dans GitHub.",
        };
        var input = new TextBox
        {
            Left = 22,
            Top = 90,
            Width = 550,
            UseSystemPasswordChar = true,
        };
        var connect = new Button
        {
            Text = "Connecter",
            Left = 420,
            Top = 142,
            Width = 152,
            DialogResult = DialogResult.OK,
        };
        var cancel = new Button
        {
            Text = "Plus tard",
            Left = 300,
            Top = 142,
            Width = 108,
            DialogResult = DialogResult.Cancel,
        };

        form.Controls.AddRange([label, input, connect, cancel]);
        form.AcceptButton = connect;
        form.CancelButton = cancel;
        form.Shown += (_, _) => input.Focus();

        if (form.ShowDialog(owner) != DialogResult.OK) return null;
        return input.Text.Trim();
    }

    private static async Task<GeometryEngineSession> EstablishSessionAsync(string initialToken, Action<string> log)
    {
        if (initialToken.Length < 16 || initialToken.Contains('\r') || initialToken.Contains('\n'))
            throw new InvalidOperationException("Le token saisi n'a pas un format valide.");

        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        var token = initialToken;
        SetBearer(client, token);

        using var sessionResponse = await client.GetAsync("https://api.opensolar.com/api/fetch_token/");
        if (!sessionResponse.IsSuccessStatusCode)
            throw new InvalidOperationException($"Le token n'a pas été accepté par le moteur géométrique ({(int)sessionResponse.StatusCode}).");

        var sessionText = await sessionResponse.Content.ReadAsStringAsync();
        using var sessionJson = JsonDocument.Parse(sessionText);
        if (TryString(sessionJson.RootElement, "token", out var refreshedToken) && !string.IsNullOrWhiteSpace(refreshedToken))
        {
            token = refreshedToken;
            SetBearer(client, token);
        }

        var orgIds = new HashSet<int>();
        CollectOrgIds(sessionJson.RootElement, orgIds, 0);
        if (orgIds.Count == 0)
        {
            foreach (Match match in OrgUrlRegex.Matches(sessionText))
                if (int.TryParse(match.Groups[1].Value, out var id) && id > 0) orgIds.Add(id);
        }

        if (orgIds.Count == 0)
            throw new InvalidOperationException("L'organisation liée à ce token n'a pas pu être détectée automatiquement.");

        int selectedOrgId = 0;
        foreach (var candidate in orgIds)
        {
            using var orgResponse = await client.GetAsync($"https://api.opensolar.com/api/orgs/{candidate}/");
            if (!orgResponse.IsSuccessStatusCode) continue;

            using var projectsResponse = await client.GetAsync($"https://api.opensolar.com/api/orgs/{candidate}/projects/?limit=1&fieldset=list");
            if (!projectsResponse.IsSuccessStatusCode) continue;

            selectedOrgId = candidate;
            break;
        }

        if (selectedOrgId < 1)
            throw new InvalidOperationException("Le token est valide, mais aucun espace de travail compatible n'est accessible.");

        var userId = FindUserId(sessionJson.RootElement, 0);
        if (userId < 1)
        {
            var match = UserUrlRegex.Match(sessionText);
            if (match.Success) int.TryParse(match.Groups[1].Value, out userId);
        }

        if (userId > 0)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Patch, $"https://api.opensolar.com/auth/users/{userId}/")
                {
                    Content = new StringContent("{\"is_machine_user\":true}", Encoding.UTF8, "application/json"),
                };
                using var response = await client.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                    log($"Persistent geometry session upgrade returned {(int)response.StatusCode}; encrypted token will still be used.");
            }
            catch (Exception ex)
            {
                log($"Persistent geometry session upgrade was not available: {ex.Message}");
            }
        }

        using var finalCheck = await client.GetAsync($"https://api.opensolar.com/api/orgs/{selectedOrgId}/projects/?limit=1&fieldset=list");
        if (!finalCheck.IsSuccessStatusCode)
            throw new InvalidOperationException("La connexion a été reconnue mais l'accès aux données projet n'est pas disponible.");

        return new GeometryEngineSession(token, selectedOrgId, userId);
    }

    private static void SetBearer(HttpClient client, string token)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Accept.Clear();
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    private static void Save(GeometryEngineSession session)
    {
        var stored = new StoredCredential(session.Token, session.OrgId, session.UserId);
        var plain = JsonSerializer.SerializeToUtf8Bytes(stored);
        try
        {
            var encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
            var directory = Path.GetDirectoryName(CredentialPath)!;
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(CredentialPath, encrypted);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static void CollectOrgIds(JsonElement element, HashSet<int> ids, int depth)
    {
        if (depth > 10) return;
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    var name = property.Name.ToLowerInvariant();
                    if (name is "org_id" or "orgid" or "organization_id" or "organisation_id")
                        AddNumericId(property.Value, ids);
                    if (name is "org" or "organization" or "organisation" or "orgs" or "organizations" or "organisations" or "role" or "roles" or "user" or "data" or "results")
                        CollectOrgIds(property.Value, ids, depth + 1);
                    else if (property.Value.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
                        CollectOrgIds(property.Value, ids, depth + 1);
                    else if (property.Value.ValueKind == JsonValueKind.String)
                        AddOrgFromString(property.Value.GetString(), ids);
                }
                break;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray()) CollectOrgIds(item, ids, depth + 1);
                break;
            case JsonValueKind.String:
                AddOrgFromString(element.GetString(), ids);
                break;
        }
    }

    private static void AddNumericId(JsonElement element, HashSet<int> ids)
    {
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) && number > 0) ids.Add(number);
        if (element.ValueKind == JsonValueKind.String && int.TryParse(element.GetString(), out number) && number > 0) ids.Add(number);
    }

    private static void AddOrgFromString(string? value, HashSet<int> ids)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        var match = OrgUrlRegex.Match(value);
        if (match.Success && int.TryParse(match.Groups[1].Value, out var id) && id > 0) ids.Add(id);
    }

    private static int FindUserId(JsonElement element, int depth)
    {
        if (depth > 10) return 0;
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                var name = property.Name.ToLowerInvariant();
                if (name is "user_id" or "userid")
                {
                    if (property.Value.ValueKind == JsonValueKind.Number && property.Value.TryGetInt32(out var numeric) && numeric > 0) return numeric;
                    if (property.Value.ValueKind == JsonValueKind.String && int.TryParse(property.Value.GetString(), out numeric) && numeric > 0) return numeric;
                }
                if (name == "user")
                {
                    if (property.Value.ValueKind == JsonValueKind.String)
                    {
                        var match = UserUrlRegex.Match(property.Value.GetString() ?? string.Empty);
                        if (match.Success && int.TryParse(match.Groups[1].Value, out var id) && id > 0) return id;
                    }
                    if (property.Value.ValueKind == JsonValueKind.Object && property.Value.TryGetProperty("id", out var idElement))
                    {
                        if (idElement.ValueKind == JsonValueKind.Number && idElement.TryGetInt32(out var id) && id > 0) return id;
                        if (idElement.ValueKind == JsonValueKind.String && int.TryParse(idElement.GetString(), out id) && id > 0) return id;
                    }
                }

                var nested = FindUserId(property.Value, depth + 1);
                if (nested > 0) return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                var nested = FindUserId(item, depth + 1);
                if (nested > 0) return nested;
            }
        }
        else if (element.ValueKind == JsonValueKind.String)
        {
            var match = UserUrlRegex.Match(element.GetString() ?? string.Empty);
            if (match.Success && int.TryParse(match.Groups[1].Value, out var id) && id > 0) return id;
        }
        return 0;
    }

    private static bool TryString(JsonElement element, string propertyName, out string value)
    {
        value = string.Empty;
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(propertyName, out var property) || property.ValueKind != JsonValueKind.String)
            return false;
        value = property.GetString() ?? string.Empty;
        return true;
    }
}
