using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace PilotPaperLauncher;

internal static class Program
{
    private const string AppUrl = "http://127.0.0.1:5173/";
    private const string ReleaseApiUrl = "https://api.github.com/repos/descombesclovis-maker/PilotPaper-V2/releases/tags/pilotpaper-desktop-latest";
    private const string ManifestAssetName = "pilotpaper-desktop-manifest.json";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new PilotPaperContext());
    }

    private sealed class PilotPaperContext : ApplicationContext
    {
        private readonly string _installRoot = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        private readonly string _appContainer;
        private readonly string _currentAppDir;
        private readonly string _runtimeDir;
        private readonly string _logPath;
        private readonly NotifyIcon _tray;
        private Process? _server;
        private bool _quitting;

        public PilotPaperContext()
        {
            _appContainer = Path.Combine(_installRoot, "app");
            _currentAppDir = Path.Combine(_appContainer, "current");
            _runtimeDir = Path.Combine(_installRoot, ".pilotpaper-runtime");
            Directory.CreateDirectory(_runtimeDir);
            Directory.CreateDirectory(_appContainer);
            _logPath = Path.Combine(_runtimeDir, "pilotpaper-desktop.log");

            _tray = new NotifyIcon
            {
                Text = "PilotPaper",
                Visible = true,
                Icon = SystemIcons.Application,
                ContextMenuStrip = BuildMenu(),
            };
            _tray.DoubleClick += (_, _) => OpenPilotPaper();

            _ = StartAsync();
        }

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Ouvrir PilotPaper", null, (_, _) => OpenPilotPaper());
            menu.Items.Add("Vérifier les mises à jour", null, async (_, _) => await CheckForUpdateAsync(showNoUpdateMessage: true));
            menu.Items.Add("Voir le journal", null, (_, _) => OpenLog());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quitter", null, (_, _) => Quit());
            return menu;
        }

        private async Task StartAsync()
        {
            try
            {
                EnsureOpenAiKey();
                await CheckForUpdateAsync(showNoUpdateMessage: false);
                EnsureInstalledPayload();

                if (await IsReadyAsync())
                {
                    OpenPilotPaper();
                    return;
                }

                StartServer();
                if (!await WaitUntilReadyAsync(TimeSpan.FromMinutes(2)))
                    throw new InvalidOperationException("PilotPaper n'a pas démarré dans le délai prévu.");

                OpenPilotPaper();
                _tray.ShowBalloonTip(2500, "PilotPaper", "PilotPaper est prêt.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                AppendLog($"START ERROR: {ex}");
                MessageBox.Show(
                    $"PilotPaper n'a pas pu démarrer.\n\n{ex.Message}\n\nJournal : {_logPath}",
                    "PilotPaper",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Quit();
            }
        }

        private void EnsureInstalledPayload()
        {
            var node = Path.Combine(_currentAppDir, "runtime", "node.exe");
            var vite = Path.Combine(_currentAppDir, "node_modules", "vite", "bin", "vite.js");
            var config = Path.Combine(_currentAppDir, "vite.config.ts");
            if (!File.Exists(node) || !File.Exists(vite) || !File.Exists(config))
                throw new InvalidOperationException("Le paquet PilotPaper installé est incomplet. Relance l'installateur une fois pour restaurer l'application.");
        }

        private string LocalVersionPath => Path.Combine(_appContainer, "current-version.txt");

        private string ReadLocalVersion()
        {
            try { return File.Exists(LocalVersionPath) ? File.ReadAllText(LocalVersionPath).Trim() : "0"; }
            catch { return "0"; }
        }

        private async Task CheckForUpdateAsync(bool showNoUpdateMessage)
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
                client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("PilotPaper", "1.0"));
                client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

                using var releaseResponse = await client.GetAsync(ReleaseApiUrl);
                if (releaseResponse.StatusCode == HttpStatusCode.NotFound)
                {
                    AppendLog("Aucune release desktop publiée pour le moment.");
                    return;
                }
                releaseResponse.EnsureSuccessStatusCode();

                using var releaseDoc = JsonDocument.Parse(await releaseResponse.Content.ReadAsStringAsync());
                var assets = releaseDoc.RootElement.GetProperty("assets").EnumerateArray().ToArray();
                var manifestAsset = assets.FirstOrDefault(asset => asset.GetProperty("name").GetString() == ManifestAssetName);
                var manifestUrl = manifestAsset.ValueKind == JsonValueKind.Undefined ? null : manifestAsset.GetProperty("browser_download_url").GetString();
                if (string.IsNullOrWhiteSpace(manifestUrl))
                {
                    AppendLog("Release desktop sans manifeste de mise à jour.");
                    return;
                }

                var manifestJson = await client.GetStringAsync(manifestUrl);
                var manifest = JsonSerializer.Deserialize<UpdateManifest>(manifestJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (manifest is null || string.IsNullOrWhiteSpace(manifest.Version) || string.IsNullOrWhiteSpace(manifest.PackageAsset) || string.IsNullOrWhiteSpace(manifest.Sha256))
                    throw new InvalidOperationException("Manifeste de mise à jour invalide.");

                var localVersion = ReadLocalVersion();
                if (string.Equals(localVersion, manifest.Version, StringComparison.Ordinal))
                {
                    if (showNoUpdateMessage)
                        MessageBox.Show($"PilotPaper {localVersion} est déjà à jour.", "PilotPaper", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                var packageAsset = assets.FirstOrDefault(asset => asset.GetProperty("name").GetString() == manifest.PackageAsset);
                var packageUrl = packageAsset.ValueKind == JsonValueKind.Undefined ? null : packageAsset.GetProperty("browser_download_url").GetString();
                if (string.IsNullOrWhiteSpace(packageUrl))
                    throw new InvalidOperationException($"Paquet de mise à jour introuvable : {manifest.PackageAsset}");

                _tray.ShowBalloonTip(2500, "PilotPaper", $"Mise à jour vers {manifest.Version}…", ToolTipIcon.Info);
                await InstallUpdateAsync(client, packageUrl, manifest);
                _tray.ShowBalloonTip(2500, "PilotPaper", $"Mise à jour {manifest.Version} installée.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                AppendLog($"UPDATE WARNING: {ex}");
                if (showNoUpdateMessage)
                    MessageBox.Show($"La vérification de mise à jour a échoué.\n\n{ex.Message}\n\nLa version déjà installée est conservée.", "PilotPaper", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private async Task InstallUpdateAsync(HttpClient client, string packageUrl, UpdateManifest manifest)
        {
            var tempRoot = Path.Combine(_runtimeDir, "update-" + Guid.NewGuid().ToString("N"));
            var zipPath = Path.Combine(tempRoot, "package.zip");
            var extractDir = Path.Combine(tempRoot, "extract");
            Directory.CreateDirectory(tempRoot);
            Directory.CreateDirectory(extractDir);

            try
            {
                await using (var source = await client.GetStreamAsync(packageUrl))
                await using (var destination = File.Create(zipPath))
                    await source.CopyToAsync(destination);

                var actualSha = Convert.ToHexString(await SHA256.HashDataAsync(File.OpenRead(zipPath))).ToLowerInvariant();
                if (!string.Equals(actualSha, manifest.Sha256.Trim().ToLowerInvariant(), StringComparison.Ordinal))
                    throw new InvalidOperationException("La signature SHA-256 du paquet ne correspond pas au manifeste. Mise à jour refusée.");

                ZipFile.ExtractToDirectory(zipPath, extractDir);
                var payloadRoot = Directory.GetDirectories(extractDir).Length == 1 && Directory.GetFiles(extractDir).Length == 0
                    ? Directory.GetDirectories(extractDir)[0]
                    : extractDir;

                ValidatePayload(payloadRoot);

                var nextDir = Path.Combine(_appContainer, "next");
                var previousDir = Path.Combine(_appContainer, "previous");
                if (Directory.Exists(nextDir)) Directory.Delete(nextDir, true);
                CopyDirectory(payloadRoot, nextDir);

                StopServer();
                if (Directory.Exists(previousDir)) Directory.Delete(previousDir, true);
                if (Directory.Exists(_currentAppDir)) Directory.Move(_currentAppDir, previousDir);

                try
                {
                    Directory.Move(nextDir, _currentAppDir);
                    File.WriteAllText(LocalVersionPath, manifest.Version, new UTF8Encoding(false));
                }
                catch
                {
                    if (Directory.Exists(_currentAppDir)) Directory.Delete(_currentAppDir, true);
                    if (Directory.Exists(previousDir)) Directory.Move(previousDir, _currentAppDir);
                    throw;
                }
            }
            finally
            {
                try { if (Directory.Exists(tempRoot)) Directory.Delete(tempRoot, true); } catch { }
            }
        }

        private static void ValidatePayload(string root)
        {
            var required = new[]
            {
                Path.Combine(root, "runtime", "node.exe"),
                Path.Combine(root, "node_modules", "vite", "bin", "vite.js"),
                Path.Combine(root, "vite.config.ts"),
                Path.Combine(root, "package.json"),
            };
            var missing = required.Where(path => !File.Exists(path)).ToArray();
            if (missing.Length > 0)
                throw new InvalidOperationException("Paquet de mise à jour incomplet : " + string.Join(", ", missing.Select(Path.GetFileName)));
        }

        private static void CopyDirectory(string sourceDir, string destinationDir)
        {
            Directory.CreateDirectory(destinationDir);
            foreach (var file in Directory.GetFiles(sourceDir))
                File.Copy(file, Path.Combine(destinationDir, Path.GetFileName(file)), true);
            foreach (var directory in Directory.GetDirectories(sourceDir))
                CopyDirectory(directory, Path.Combine(destinationDir, Path.GetFileName(directory)));
        }

        private void EnsureOpenAiKey()
        {
            var varsPath = Path.Combine(_installRoot, ".dev.vars");
            if (File.Exists(varsPath))
            {
                var existing = File.ReadAllLines(varsPath)
                    .FirstOrDefault(line => line.StartsWith("OPENAI_API_KEY=", StringComparison.Ordinal));
                if (!string.IsNullOrWhiteSpace(existing?.Split('=', 2).ElementAtOrDefault(1))) return;
            }

            using var form = new Form
            {
                Text = "Configuration PilotPaper",
                Width = 520,
                Height = 220,
                StartPosition = FormStartPosition.CenterScreen,
                FormBorderStyle = FormBorderStyle.FixedDialog,
                MaximizeBox = false,
                MinimizeBox = false,
            };

            var label = new Label { Left = 20, Top = 20, Width = 460, Height = 42, Text = "Colle ta clé API OpenAI. Elle reste uniquement sur ce PC." };
            var input = new TextBox { Left = 20, Top = 72, Width = 460, UseSystemPasswordChar = true };
            var save = new Button { Text = "Enregistrer et démarrer", Left = 275, Top = 112, Width = 205, DialogResult = DialogResult.OK };
            var cancel = new Button { Text = "Annuler", Left = 175, Top = 112, Width = 90, DialogResult = DialogResult.Cancel };

            form.Controls.AddRange([label, input, save, cancel]);
            form.AcceptButton = save;
            form.CancelButton = cancel;
            if (form.ShowDialog() != DialogResult.OK) throw new OperationCanceledException("Configuration OpenAI annulée.");

            var key = input.Text.Trim();
            if (key.Length < 20 || key.Contains('\n') || key.Contains('\r')) throw new InvalidOperationException("La clé OpenAI saisie n'est pas valide.");
            File.WriteAllText(varsPath, $"OPENAI_API_KEY={key}{Environment.NewLine}", new UTF8Encoding(false));
        }

        private void StartServer()
        {
            EnsureInstalledPayload();
            var node = Path.Combine(_currentAppDir, "runtime", "node.exe");
            var vite = Path.Combine(_currentAppDir, "node_modules", "vite", "bin", "vite.js");
            var varsPath = Path.Combine(_installRoot, ".dev.vars");

            var psi = new ProcessStartInfo
            {
                FileName = node,
                WorkingDirectory = _currentAppDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add(vite);
            psi.ArgumentList.Add("--host"); psi.ArgumentList.Add("127.0.0.1");
            psi.ArgumentList.Add("--port"); psi.ArgumentList.Add("5173");
            psi.ArgumentList.Add("--strictPort");

            psi.Environment["DP_TEST_EXPORT"] = "false";
            psi.Environment["DP_TEST_FAST"] = "false";
            psi.Environment["DP_MAX_RETRIES"] = "5";
            psi.Environment["NODE_ENV"] = "development";
            if (File.Exists(varsPath))
            {
                foreach (var line in File.ReadAllLines(varsPath))
                {
                    var split = line.Split('=', 2);
                    if (split.Length == 2 && !string.IsNullOrWhiteSpace(split[0])) psi.Environment[split[0].Trim()] = split[1];
                }
            }

            _server = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _server.OutputDataReceived += (_, e) => AppendLog(e.Data);
            _server.ErrorDataReceived += (_, e) => AppendLog(e.Data);
            _server.Exited += (_, _) => { if (!_quitting) AppendLog($"Server exited with code {_server?.ExitCode}"); };
            if (!_server.Start()) throw new InvalidOperationException("Impossible de lancer le moteur PilotPaper.");
            _server.BeginOutputReadLine();
            _server.BeginErrorReadLine();
        }

        private void StopServer()
        {
            try { if (_server is { HasExited: false }) _server.Kill(entireProcessTree: true); } catch { }
            try { _server?.Dispose(); } catch { }
            _server = null;
        }

        private void AppendLog(string? line)
        {
            if (string.IsNullOrWhiteSpace(line)) return;
            try { File.AppendAllText(_logPath, $"{DateTime.Now:O} {line}{Environment.NewLine}"); } catch { }
        }

        private static async Task<bool> IsReadyAsync()
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var response = await client.GetAsync(AppUrl);
                return response.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        private static async Task<bool> WaitUntilReadyAsync(TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                if (await IsReadyAsync()) return true;
                await Task.Delay(800);
            }
            return false;
        }

        private static void OpenPilotPaper() => Process.Start(new ProcessStartInfo(AppUrl) { UseShellExecute = true });

        private void OpenLog()
        {
            if (!File.Exists(_logPath)) File.WriteAllText(_logPath, "PilotPaper desktop log\r\n");
            Process.Start(new ProcessStartInfo(_logPath) { UseShellExecute = true });
        }

        private void Quit()
        {
            if (_quitting) return;
            _quitting = true;
            StopServer();
            _tray.Visible = false;
            _tray.Dispose();
            ExitThread();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && !_quitting) Quit();
            base.Dispose(disposing);
        }
    }

    private sealed class UpdateManifest
    {
        public string Version { get; set; } = "";
        public string PackageAsset { get; set; } = "";
        public string Sha256 { get; set; } = "";
    }
}
