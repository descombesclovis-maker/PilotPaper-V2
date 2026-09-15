using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace PilotPaperLauncher;

internal static class PilotPaperV2Bootstrap
{
    private const string MutexName = "Local\\PilotPaper-V2-SingleInstance";
    private static readonly byte[] GeometryEntropy = Encoding.UTF8.GetBytes("PilotPaper-V2-GeometryEngine-v1");

    private sealed record StoredGeometryCredential(string Token, int OrgId, int UserId, int SchemaVersion = 2);

    private static string InstallRoot => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static string VarsPath => Path.Combine(InstallRoot, ".dev.vars");
    private static string GeometryCredentialPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "PilotPaper",
        "V2",
        "geometry-engine.bin");

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew) return;

        ApplicationConfiguration.Initialize();

        try
        {
            if (!EnsureVisualCredentialAsync().GetAwaiter().GetResult()) return;
            ValidateStoredGeometryCredentialAsync().GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"La vérification des moteurs PilotPaper a rencontré un problème.\n\n{ex.Message}",
                "PilotPaper V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }

        using var window = new PilotPaperV2Window();
        Application.Run(window);
        GC.KeepAlive(mutex);
    }

    private static async Task<bool> EnsureVisualCredentialAsync()
    {
        var existing = ReadLocalVar("OPENAI_API_KEY");
        if (!string.IsNullOrWhiteSpace(existing))
        {
            var check = await CheckVisualCredentialAsync(existing);
            if (check.State == CredentialState.Valid) return true;
            if (check.State == CredentialState.Indeterminate) return true;

            RemoveLocalVar("OPENAI_API_KEY");
            MessageBox.Show(
                "La clé enregistrée pour le moteur visuel n'est plus valide. PilotPaper va vous demander une nouvelle clé.\n\nAttention : cette clé est différente du token du moteur géométrique.",
                "PilotPaper V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }

        while (true)
        {
            var key = PromptForVisualKey();
            if (string.IsNullOrWhiteSpace(key)) return false;

            var check = await CheckVisualCredentialAsync(key);
            if (check.State == CredentialState.Valid)
            {
                WriteLocalVar("OPENAI_API_KEY", key.Trim());
                return true;
            }

            var message = check.State == CredentialState.Invalid
                ? check.Message
                : $"La clé n'a pas pu être vérifiée pour le moment.\n\n{check.Message}";
            var retry = MessageBox.Show(
                $"{message}\n\nVoulez-vous saisir une autre clé ?",
                "PilotPaper V2",
                MessageBoxButtons.RetryCancel,
                MessageBoxIcon.Warning);
            if (retry != DialogResult.Retry) return false;
        }
    }

    private enum CredentialState
    {
        Valid,
        Invalid,
        Indeterminate,
    }

    private sealed record CredentialCheck(CredentialState State, string Message);

    private static async Task<CredentialCheck> CheckVisualCredentialAsync(string key)
    {
        if (key.Length < 20 || key.Contains('\r') || key.Contains('\n'))
            return new(CredentialState.Invalid, "Le format de la clé du moteur visuel est invalide.");

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key.Trim());
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await client.GetAsync("https://api.openai.com/v1/models");

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
                return new(CredentialState.Invalid, "La clé du moteur visuel a été refusée. Vérifiez que vous avez collé une clé API du moteur visuel, et non le token du moteur géométrique.");

            if (!response.IsSuccessStatusCode)
                return new(CredentialState.Indeterminate, $"Le service de validation a répondu {(int)response.StatusCode}.");

            var payload = await response.Content.ReadAsStringAsync();
            using var json = JsonDocument.Parse(payload);
            var models = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (json.RootElement.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                foreach (var model in data.EnumerateArray())
                {
                    if (model.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                    {
                        var value = id.GetString();
                        if (!string.IsNullOrWhiteSpace(value)) models.Add(value);
                    }
                }
            }

            if (!models.Contains("gpt-image-2"))
                return new(CredentialState.Invalid, "La clé est reconnue, mais le modèle d'image requis par PilotPaper n'est pas disponible pour ce projet API.");

            return new(CredentialState.Valid, "Clé visuelle validée.");
        }
        catch (HttpRequestException ex)
        {
            return new(CredentialState.Indeterminate, $"Connexion au service de validation impossible : {ex.Message}");
        }
        catch (TaskCanceledException)
        {
            return new(CredentialState.Indeterminate, "Le service de validation n'a pas répondu dans le délai prévu.");
        }
    }

    private static async Task ValidateStoredGeometryCredentialAsync()
    {
        if (!File.Exists(GeometryCredentialPath)) return;

        StoredGeometryCredential? stored = null;
        byte[]? plain = null;
        try
        {
            var encrypted = await File.ReadAllBytesAsync(GeometryCredentialPath);
            plain = ProtectedData.Unprotect(encrypted, GeometryEntropy, DataProtectionScope.CurrentUser);
            stored = JsonSerializer.Deserialize<StoredGeometryCredential>(plain);
        }
        catch
        {
            TryDeleteGeometryCredential();
            return;
        }
        finally
        {
            if (plain is not null) CryptographicOperations.ZeroMemory(plain);
        }

        if (stored is null || string.IsNullOrWhiteSpace(stored.Token) || stored.OrgId < 1)
        {
            TryDeleteGeometryCredential();
            return;
        }

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", stored.Token);
            using var response = await client.GetAsync($"https://api.opensolar.com/api/orgs/{stored.OrgId}/projects/?limit=1&fieldset=list");
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                TryDeleteGeometryCredential();
                MessageBox.Show(
                    "La connexion enregistrée du moteur géométrique n'est plus valide. Elle vous sera redemandée une seule fois au démarrage.",
                    "PilotPaper V2",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch
        {
            // A temporary network outage must never erase an otherwise valid encrypted credential.
        }
    }

    private static string? PromptForVisualKey()
    {
        using var form = new Form
        {
            Text = "PilotPaper V2 — Moteur visuel",
            Width = 620,
            Height = 280,
            StartPosition = FormStartPosition.CenterScreen,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = true,
        };
        var label = new Label
        {
            Left = 22,
            Top = 20,
            Width = 560,
            Height = 82,
            Text = "Collez la clé API du moteur visuel.\n\nNe collez pas ici le token du moteur géométrique : PilotPaper vous le demandera séparément et le validera lui aussi.",
        };
        var input = new TextBox { Left = 22, Top = 108, Width = 560, UseSystemPasswordChar = true };
        var save = new Button { Text = "Vérifier et enregistrer", Left = 395, Top = 160, Width = 187, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Annuler", Left = 275, Top = 160, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, input, save, cancel]);
        form.AcceptButton = save;
        form.CancelButton = cancel;
        form.Shown += (_, _) => input.Focus();
        if (form.ShowDialog() != DialogResult.OK) return null;
        return input.Text.Trim();
    }

    private static string? ReadLocalVar(string name)
    {
        if (!File.Exists(VarsPath)) return null;
        var prefix = name + "=";
        var line = File.ReadAllLines(VarsPath).FirstOrDefault(candidate => candidate.StartsWith(prefix, StringComparison.Ordinal));
        return line?.Split('=', 2).ElementAtOrDefault(1)?.Trim();
    }

    private static void WriteLocalVar(string name, string value)
    {
        var prefix = name + "=";
        var lines = File.Exists(VarsPath)
            ? File.ReadAllLines(VarsPath).Where(line => !line.StartsWith(prefix, StringComparison.Ordinal)).ToList()
            : new List<string>();
        lines.Add($"{name}={value}");
        File.WriteAllLines(VarsPath, lines, new UTF8Encoding(false));
    }

    private static void RemoveLocalVar(string name)
    {
        if (!File.Exists(VarsPath)) return;
        var prefix = name + "=";
        var lines = File.ReadAllLines(VarsPath).Where(line => !line.StartsWith(prefix, StringComparison.Ordinal)).ToArray();
        File.WriteAllLines(VarsPath, lines, new UTF8Encoding(false));
    }

    private static void TryDeleteGeometryCredential()
    {
        try
        {
            if (File.Exists(GeometryCredentialPath)) File.Delete(GeometryCredentialPath);
        }
        catch { }
    }
}
