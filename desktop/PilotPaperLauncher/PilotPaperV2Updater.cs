using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace PilotPaperLauncher;

internal sealed partial class PilotPaperV2Window
{
    private const string UpdateReleaseApiUrl = "https://api.github.com/repos/descombesclovis-maker/PilotPaper-V2/releases/tags/pilotpaper-v2-latest";
    private const string UpdateSetupAssetName = "PilotPaper-V2-Setup.exe";
    private const string UpdateHashAssetName = "PilotPaper-V2-Setup.exe.sha256";
    private const string BuildShaPrefix = "PilotPaper-Build-SHA:";

    private bool _updateInProgress;
    private string BuildMarkerPath => Path.Combine(_installRoot, "PILOTPAPER-BUILD.txt");

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var message = args.TryGetWebMessageAsString();
            if (message == "CHECK_UPDATE") await CheckForUpdateAsync();
        }
        catch (Exception ex)
        {
            AppendLog($"UPDATE BRIDGE ERROR: {ex}");
            PostUpdateStatus("error", "La vérification de mise à jour a échoué.");
        }
    }

    private async Task CheckForUpdateAsync()
    {
        if (_updateInProgress) return;
        _updateInProgress = true;
        PostUpdateStatus("checking", "Vérification de la dernière V2…");

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("PilotPaper-V2-Updater/1.0");
            client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            using var releaseResponse = await client.GetAsync(UpdateReleaseApiUrl);
            if (releaseResponse.StatusCode == System.Net.HttpStatusCode.NotFound)
                throw new InvalidOperationException("Aucune mise à jour V2 validée n'est encore publiée.");
            releaseResponse.EnsureSuccessStatusCode();

            var releaseJson = await releaseResponse.Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(releaseJson);
            var root = document.RootElement;
            var releaseBody = root.TryGetProperty("body", out var bodyElement)
                ? bodyElement.GetString() ?? string.Empty
                : string.Empty;
            var targetBuild = ExtractPublishedBuildSha(releaseBody);
            if (string.IsNullOrWhiteSpace(targetBuild))
                throw new InvalidOperationException("La release V2 publiée ne contient pas l'identifiant de build attendu.");

            string? setupUrl = null;
            string? hashUrl = null;
            if (root.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.TryGetProperty("name", out var nameElement) ? nameElement.GetString() : null;
                    var url = asset.TryGetProperty("browser_download_url", out var urlElement) ? urlElement.GetString() : null;
                    if (string.Equals(name, UpdateSetupAssetName, StringComparison.Ordinal)) setupUrl = url;
                    if (string.Equals(name, UpdateHashAssetName, StringComparison.Ordinal)) hashUrl = url;
                }
            }

            if (string.IsNullOrWhiteSpace(setupUrl) || string.IsNullOrWhiteSpace(hashUrl))
                throw new InvalidOperationException("La release V2 est incomplète : installeur ou empreinte SHA-256 absent.");

            var installedBuild = File.Exists(BuildMarkerPath) ? File.ReadAllText(BuildMarkerPath).Trim() : string.Empty;
            if (!string.IsNullOrWhiteSpace(installedBuild) && string.Equals(installedBuild, targetBuild, StringComparison.OrdinalIgnoreCase))
            {
                PostUpdateStatus("current", "PilotPaper V2 est à jour.");
                return;
            }

            PostUpdateStatus("available", "Une nouvelle V2 validée est disponible.");
            var choice = MessageBox.Show(
                this,
                "Une nouvelle version validée de PilotPaper V2 est disponible.\n\nTélécharger, vérifier et installer maintenant ?",
                "Mise à jour PilotPaper V2",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (choice != DialogResult.Yes)
            {
                PostUpdateStatus("idle", "Mise à jour laissée en attente.");
                return;
            }

            Directory.CreateDirectory(_runtimeDir);
            var updatePath = Path.Combine(_runtimeDir, "PilotPaper-V2-Update.exe");
            if (File.Exists(updatePath)) File.Delete(updatePath);

            PostUpdateStatus("downloading", "Téléchargement de la mise à jour V2…");
            using (var downloadResponse = await client.GetAsync(setupUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                downloadResponse.EnsureSuccessStatusCode();
                await using var input = await downloadResponse.Content.ReadAsStreamAsync();
                await using var output = new FileStream(updatePath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 128, useAsync: true);
                await input.CopyToAsync(output);
            }

            var expectedHash = await DownloadExpectedHashAsync(client, hashUrl);
            var actualHash = await ComputeSha256Async(updatePath);
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(updatePath); } catch { }
                throw new InvalidOperationException("L'empreinte SHA-256 de la mise à jour ne correspond pas au fichier publié. Installation annulée.");
            }

            PostUpdateStatus("installing", "Mise à jour vérifiée. Lancement de l'installeur…");
            Process.Start(new ProcessStartInfo(updatePath) { UseShellExecute = true });
            BeginInvoke(Close);
        }
        catch (Exception ex)
        {
            AppendLog($"UPDATE ERROR: {ex}");
            PostUpdateStatus("error", "La mise à jour V2 n'a pas pu être effectuée.");
            MessageBox.Show(
                this,
                $"La mise à jour n'a pas pu être effectuée.\n\n{ex.Message}",
                "Mise à jour PilotPaper V2",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
        finally
        {
            _updateInProgress = false;
        }
    }

    private static string ExtractPublishedBuildSha(string releaseBody)
    {
        foreach (var rawLine in releaseBody.Split('\n'))
        {
            var line = rawLine.Trim();
            if (!line.StartsWith(BuildShaPrefix, StringComparison.OrdinalIgnoreCase)) continue;
            return line[BuildShaPrefix.Length..].Trim();
        }
        return string.Empty;
    }

    private static async Task<string> DownloadExpectedHashAsync(HttpClient client, string hashUrl)
    {
        var text = (await client.GetStringAsync(hashUrl)).Trim();
        var token = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? string.Empty;
        if (token.Length != 64 || token.Any(character => !Uri.IsHexDigit(character)))
            throw new InvalidOperationException("L'empreinte SHA-256 publiée est invalide.");
        return token.ToLowerInvariant();
    }

    private static async Task<string> ComputeSha256Async(string path)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 128, useAsync: true);
        using var sha256 = SHA256.Create();
        var digest = await sha256.ComputeHashAsync(stream);
        return Convert.ToHexString(digest).ToLowerInvariant();
    }

    private void PostUpdateStatus(string status, string message)
    {
        if (_webView.CoreWebView2 is null) return;
        try
        {
            var payload = JsonSerializer.Serialize(new { type = "pilotpaper-update-status", status, message });
            _webView.CoreWebView2.PostWebMessageAsJson(payload);
        }
        catch (Exception ex)
        {
            AppendLog($"UPDATE STATUS ERROR: {ex.Message}");
        }
    }
}
