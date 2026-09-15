using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PilotPaperLauncher;

internal sealed record GeometryEngineSession(string Token, int OrgId, int UserId);

internal static class GeometryEngineCredentials
{
    private const string AuthUrl = "https://api.opensolar.com/api-token-auth/";
    private const string FetchTokenUrl = "https://api.opensolar.com/api/fetch_token/";
    private const string ApiBase = "https://api.opensolar.com/api";
    private const string UserBase = "https://api.opensolar.com/auth/users";
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PilotPaper-V2-GeometryEngine-v1");

    private sealed record StoredCredential(string Token, int OrgId, int UserId, int SchemaVersion = 1);
    private sealed record LoginInput(string Email, string Password, string Mfa);
    private sealed record OrgCandidate(int Id, string Name);

    private static string CredentialDirectory => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PilotPaper",
        "V2");

    private static string CredentialPath => Path.Combine(CredentialDirectory, "geometry-engine.bin");

    internal static async Task<GeometryEngineSession?> EnsureAsync(Form owner, Action<string> log)
    {
        try
        {
            var stored = Load();
            if (stored is not null)
            {
                var existing = new GeometryEngineSession(stored.Token, stored.OrgId, stored.UserId);
                if (await ValidateSessionAsync(existing))
                {
                    log("Geometry engine credential loaded from Windows protected storage.");
                    return existing;
                }

                log("Stored geometry engine credential is no longer valid; a new one-time connection is required.");
                TryDeleteStoredCredential();
            }
        }
        catch (Exception ex)
        {
            log($"Geometry credential read failed: {ex.Message}");
            TryDeleteStoredCredential();
        }

        while (true)
        {
            var login = PromptForLogin(owner);
            if (login is null)
            {
                log("Geometry engine connection skipped by user; PilotPaper will continue with its fallback engine.");
                return null;
            }

            try
            {
                var session = await AuthenticateAndPersistAsync(owner, login, log);
                MessageBox.Show(
                    owner,
                    "Le moteur géométrique est connecté et protégé sur ce compte Windows. Cette connexion ne sera plus redemandée tant que l'accès n'est pas révoqué.",
                    "PilotPaper V2",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
                return session;
            }
            catch (Exception ex)
            {
                log($"Geometry engine bootstrap failed: {ex}");
                var retry = MessageBox.Show(
                    owner,
                    $"La connexion au moteur géométrique n'a pas pu être finalisée.\n\n{FriendlyError(ex.Message)}\n\nRéessayer maintenant ?",
                    "PilotPaper V2",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (retry != DialogResult.Yes) return null;
            }
        }
    }

    private static LoginInput? PromptForLogin(Form owner)
    {
        using var form = new Form
        {
            Text = "PilotPaper V2 — Connexion du moteur géométrique",
            Width = 610,
            Height = 365,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };

        var title = new Label
        {
            Left = 24,
            Top = 20,
            Width = 545,
            Height = 32,
            Text = "Connexion unique au moteur géométrique",
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
        };
        var info = new Label
        {
            Left = 24,
            Top = 57,
            Width = 545,
            Height = 48,
            Text = "Ces informations servent uniquement à obtenir l'accès technique. Le mot de passe n'est jamais enregistré. Le jeton final est chiffré par Windows pour ce compte utilisateur.",
        };

        var emailLabel = new Label { Left = 24, Top = 116, Width = 150, Text = "E-mail" };
        var email = new TextBox { Left = 24, Top = 137, Width = 545 };
        var passwordLabel = new Label { Left = 24, Top = 177, Width = 150, Text = "Mot de passe" };
        var password = new TextBox { Left = 24, Top = 198, Width = 545, UseSystemPasswordChar = true };
        var mfaLabel = new Label { Left = 24, Top = 238, Width = 300, Text = "Code MFA (si activé)" };
        var mfa = new TextBox { Left = 24, Top = 259, Width = 210, MaxLength = 12 };

        var connect = new Button { Text = "Connecter", Left = 417, Top = 295, Width = 152, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Plus tard", Left = 297, Top = 295, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([title, info, emailLabel, email, passwordLabel, password, mfaLabel, mfa, connect, cancel]);
        form.AcceptButton = connect;
        form.CancelButton = cancel;

        if (form.ShowDialog(owner) != DialogResult.OK) return null;
        var emailValue = email.Text.Trim();
        var passwordValue = password.Text;
        var mfaValue = mfa.Text.Trim();
        if (string.IsNullOrWhiteSpace(emailValue) || string.IsNullOrWhiteSpace(passwordValue))
            throw new InvalidOperationException("L'e-mail et le mot de passe sont requis.");
        return new LoginInput(emailValue, passwordValue, mfaValue);
    }

    private static async Task<GeometryEngineSession> AuthenticateAndPersistAsync(Form owner, LoginInput login, Action<string> log)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(40) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("PilotPaper-V2-Geometry/1.0");

        string token;
        int userId;
        var orgIds = new HashSet<int>();

        using (var authResponse = await http.PostAsync(AuthUrl, Json(new Dictionary<string, string>
        {
            ["username"] = login.Email,
            ["password"] = login.Password,
            ...(string.IsNullOrWhiteSpace(login.Mfa) ? new Dictionary<string, string>() : new Dictionary<string, string> { ["token"] = login.Mfa }),
        })))
        {
            var authJson = await ReadJsonAsync(authResponse, "Authentification refusée");
            token = ReadString(authJson.RootElement, "token") ?? throw new InvalidOperationException("Aucun jeton d'accès n'a été retourné.");
            userId = FindUserId(authJson.RootElement);
            FindOrgIds(authJson.RootElement, orgIds);
        }

        SetBearer(http, token);
        using (var fetchResponse = await http.GetAsync(FetchTokenUrl))
        {
            var fetchJson = await ReadJsonAsync(fetchResponse, "Validation de session impossible");
            token = ReadString(fetchJson.RootElement, "token") ?? token;
            SetBearer(http, token);
            if (userId < 1) userId = FindUserId(fetchJson.RootElement);
            FindOrgIds(fetchJson.RootElement, orgIds);
        }

        if (userId < 1) throw new InvalidOperationException("L'identifiant technique du compte n'a pas pu être déterminé.");

        var validOrgs = new List<OrgCandidate>();
        foreach (var id in orgIds.Where(id => id > 0))
        {
            try
            {
                using var response = await http.GetAsync($"{ApiBase}/orgs/{id}/");
                if (!response.IsSuccessStatusCode) continue;
                using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
                var name = ReadString(json.RootElement, "name") ?? $"Organisation {id}";
                validOrgs.Add(new OrgCandidate(id, name));
            }
            catch
            {
                // Candidate IDs can include unrelated nested resources; ignore them.
            }
        }

        var selectedOrg = validOrgs.Count switch
        {
            1 => validOrgs[0],
            > 1 => PromptForOrg(owner, validOrgs) ?? throw new OperationCanceledException("Sélection de l'organisation annulée."),
            _ => await PromptAndValidateOrgAsync(owner, http),
        };

        using (var projectsResponse = await http.GetAsync($"{ApiBase}/orgs/{selectedOrg.Id}/projects/?limit=1&fieldset=list"))
        {
            if (!projectsResponse.IsSuccessStatusCode)
                throw new InvalidOperationException("L'accès aux projets n'est pas encore disponible pour cette organisation.");
        }

        using (var patch = new HttpRequestMessage(HttpMethod.Patch, $"{UserBase}/{userId}/"))
        {
            patch.Content = Json(new { is_machine_user = true });
            using var patchResponse = await http.SendAsync(patch);
            if (!patchResponse.IsSuccessStatusCode)
            {
                var detail = await patchResponse.Content.ReadAsStringAsync();
                throw new InvalidOperationException($"La connexion permanente n'a pas pu être activée ({(int)patchResponse.StatusCode}). {detail}".Trim());
            }
        }

        var session = new GeometryEngineSession(token, selectedOrg.Id, userId);
        if (!await ValidateSessionAsync(session))
            throw new InvalidOperationException("La session persistante n'a pas pu être vérifiée après sa création.");

        Save(new StoredCredential(token, selectedOrg.Id, userId));
        log($"Geometry engine persistent session ready for org {selectedOrg.Id}, user {userId}.");
        return session;
    }

    private static async Task<OrgCandidate> PromptAndValidateOrgAsync(Form owner, HttpClient http)
    {
        var raw = PromptForText(owner, "PilotPaper V2", "Identifiant numérique de l'organisation :");
        if (!int.TryParse(raw, out var id) || id < 1) throw new InvalidOperationException("Identifiant d'organisation invalide.");
        using var response = await http.GetAsync($"{ApiBase}/orgs/{id}/");
        var json = await ReadJsonAsync(response, "Organisation inaccessible");
        return new OrgCandidate(id, ReadString(json.RootElement, "name") ?? $"Organisation {id}");
    }

    private static OrgCandidate? PromptForOrg(Form owner, IReadOnlyList<OrgCandidate> orgs)
    {
        using var form = new Form
        {
            Text = "PilotPaper V2 — Organisation",
            Width = 520,
            Height = 220,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };
        var label = new Label { Left = 22, Top = 20, Width = 460, Height = 40, Text = "Choisissez l'organisation utilisée par le moteur géométrique :" };
        var combo = new ComboBox { Left = 22, Top = 66, Width = 460, DropDownStyle = ComboBoxStyle.DropDownList };
        combo.Items.AddRange(orgs.Select(org => $"{org.Name} ({org.Id})").Cast<object>().ToArray());
        combo.SelectedIndex = 0;
        var ok = new Button { Text = "Continuer", Left = 330, Top = 112, Width = 152, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Annuler", Left = 210, Top = 112, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, combo, ok, cancel]);
        form.AcceptButton = ok;
        form.CancelButton = cancel;
        if (form.ShowDialog(owner) != DialogResult.OK) return null;
        return orgs[Math.Max(0, combo.SelectedIndex)];
    }

    private static string? PromptForText(Form owner, string title, string labelText)
    {
        using var form = new Form
        {
            Text = title,
            Width = 500,
            Height = 190,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };
        var label = new Label { Left = 22, Top = 20, Width = 440, Height = 28, Text = labelText };
        var input = new TextBox { Left = 22, Top = 54, Width = 440 };
        var ok = new Button { Text = "Continuer", Left = 310, Top = 96, Width = 152, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Annuler", Left = 190, Top = 96, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, input, ok, cancel]);
        form.AcceptButton = ok;
        form.CancelButton = cancel;
        return form.ShowDialog(owner) == DialogResult.OK ? input.Text.Trim() : null;
    }

    private static async Task<bool> ValidateSessionAsync(GeometryEngineSession session)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("PilotPaper-V2-Geometry/1.0");
            SetBearer(http, session.Token);
            using var response = await http.GetAsync($"{ApiBase}/orgs/{session.OrgId}/");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private static void Save(StoredCredential credential)
    {
        Directory.CreateDirectory(CredentialDirectory);
        var plain = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(credential));
        try
        {
            var protectedBytes = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(CredentialPath, protectedBytes);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static StoredCredential? Load()
    {
        if (!File.Exists(CredentialPath)) return null;
        var protectedBytes = File.ReadAllBytes(CredentialPath);
        var plain = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
        try
        {
            return JsonSerializer.Deserialize<StoredCredential>(plain);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plain);
        }
    }

    private static void TryDeleteStoredCredential()
    {
        try { if (File.Exists(CredentialPath)) File.Delete(CredentialPath); } catch { }
    }

    private static StringContent Json(object value) => new(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");

    private static void SetBearer(HttpClient http, string token)
    {
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    private static async Task<JsonDocument> ReadJsonAsync(HttpResponseMessage response, string prefix)
    {
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"{prefix} ({(int)response.StatusCode}). {body}".Trim());
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
    }

    private static string? ReadString(JsonElement element, string property)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(property, out var value)) return null;
        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static int FindUserId(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("user", out var user))
        {
            if (user.ValueKind == JsonValueKind.Object && user.TryGetProperty("id", out var id) && id.TryGetInt32(out var parsed) && parsed > 0) return parsed;
            if (user.ValueKind == JsonValueKind.String && TryParseUserUrl(user.GetString(), out parsed)) return parsed;
        }
        return FindUserIdRecursive(root, 0);
    }

    private static int FindUserIdRecursive(JsonElement node, int depth)
    {
        if (depth > 8) return 0;
        if (node.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in node.EnumerateObject())
            {
                if (property.NameEquals("user"))
                {
                    if (property.Value.ValueKind == JsonValueKind.Object && property.Value.TryGetProperty("id", out var id) && id.TryGetInt32(out var parsed) && parsed > 0) return parsed;
                    if (property.Value.ValueKind == JsonValueKind.String && TryParseUserUrl(property.Value.GetString(), out parsed)) return parsed;
                }
                var nested = FindUserIdRecursive(property.Value, depth + 1);
                if (nested > 0) return nested;
            }
        }
        else if (node.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in node.EnumerateArray())
            {
                var nested = FindUserIdRecursive(item, depth + 1);
                if (nested > 0) return nested;
            }
        }
        return 0;
    }

    private static bool TryParseUserUrl(string? value, out int userId)
    {
        userId = 0;
        if (string.IsNullOrWhiteSpace(value)) return false;
        const string marker = "/auth/users/";
        var index = value.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return false;
        var tail = value[(index + marker.Length)..].Trim('/');
        var first = tail.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return int.TryParse(first, out userId) && userId > 0;
    }

    private static void FindOrgIds(JsonElement node, HashSet<int> ids, int depth = 0)
    {
        if (depth > 8) return;
        if (node.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in node.EnumerateObject())
            {
                var name = property.Name.ToLowerInvariant();
                if (name is "org_id" or "organization_id" or "organisation_id")
                {
                    if (property.Value.TryGetInt32(out var id) && id > 0) ids.Add(id);
                    else if (int.TryParse(property.Value.ToString(), out id) && id > 0) ids.Add(id);
                }
                else if (name is "org" or "organization" or "organisation")
                {
                    if (property.Value.ValueKind == JsonValueKind.String && TryParseOrgUrl(property.Value.GetString(), out var id)) ids.Add(id);
                    FindOrgIds(property.Value, ids, depth + 1);
                }
                else if (name is "orgs" or "organizations" or "organisations" or "user" or "role" or "roles" or "data" or "results")
                {
                    FindOrgIds(property.Value, ids, depth + 1);
                }
            }
        }
        else if (node.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in node.EnumerateArray()) FindOrgIds(item, ids, depth + 1);
        }
    }

    private static bool TryParseOrgUrl(string? value, out int orgId)
    {
        orgId = 0;
        if (string.IsNullOrWhiteSpace(value)) return false;
        const string marker = "/api/orgs/";
        var index = value.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (index < 0) return false;
        var tail = value[(index + marker.Length)..].Trim('/');
        var first = tail.Split('/', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return int.TryParse(first, out orgId) && orgId > 0;
    }

    private static string FriendlyError(string message)
    {
        if (message.Contains("401", StringComparison.OrdinalIgnoreCase) || message.Contains("403", StringComparison.OrdinalIgnoreCase))
            return "Identifiants ou code MFA refusés.";
        if (message.Contains("402", StringComparison.OrdinalIgnoreCase))
            return "L'accès aux données géométriques avancées n'est pas actif pour cette organisation.";
        if (message.Contains("429", StringComparison.OrdinalIgnoreCase))
            return "Le service est temporairement saturé. Patientez quelques instants puis réessayez.";
        return message.Replace("OpenSolar", "moteur géométrique", StringComparison.OrdinalIgnoreCase);
    }
}
