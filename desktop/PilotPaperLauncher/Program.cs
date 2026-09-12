using System.Diagnostics;
using System.IO.Pipes;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PilotPaperLauncher;

internal static class Program
{
    private const string MutexName = "Local\\PilotPaper-V1-KParK-SingleInstance";
    private const string PipeName = "PilotPaper-V1-KParK-Activate";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew)
        {
            SignalExistingInstance();
            return;
        }

        ApplicationConfiguration.Initialize();
        using var window = new PilotPaperWindow();
        _ = ListenForActivationAsync(window);
        Application.Run(window);
        GC.KeepAlive(mutex);
    }

    private static void SignalExistingInstance()
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(1200);
            using var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true };
            writer.WriteLine("SHOW");
        }
        catch
        {
            // A second click must never launch another server or browser window.
        }
    }

    private static async Task ListenForActivationAsync(Form window)
    {
        while (!window.IsDisposed)
        {
            try
            {
                using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync();
                using var reader = new StreamReader(server, Encoding.UTF8);
                var command = await reader.ReadLineAsync();
                if (command == "SHOW" && !window.IsDisposed)
                {
                    window.BeginInvoke(() =>
                    {
                        if (window.WindowState == FormWindowState.Minimized) window.WindowState = FormWindowState.Normal;
                        window.Show();
                        window.Activate();
                        window.BringToFront();
                    });
                }
            }
            catch when (!window.IsDisposed)
            {
                await Task.Delay(250);
            }
        }
    }
}

internal sealed class PilotPaperWindow : Form
{
    private const string AppUrl = "http://127.0.0.1:5174/";
    private const string ReleaseApiUrl = "https://api.github.com/repos/descombesclovis-maker/PilotPaper-V2/releases/tags/pilotpaper-v1-test-latest";
    private const string SetupAssetName = "PilotPaper-V1-Setup.exe";

    private readonly string _installRoot = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private readonly string _currentAppDir;
    private readonly string _runtimeDir;
    private readonly string _logPath;
    private readonly string _buildMarkerPath;
    private readonly WebView2 _webView;
    private readonly Panel _startupPanel;
    private readonly Label _startupTitle;
    private readonly Label _startupDetail;
    private Process? _server;
    private bool _closing;
    private bool _updateInProgress;

    public PilotPaperWindow()
    {
        _currentAppDir = Path.Combine(_installRoot, "app", "current");
        _runtimeDir = Path.Combine(_installRoot, ".pilotpaper-runtime");
        _logPath = Path.Combine(_runtimeDir, "pilotpaper-v1.log");
        _buildMarkerPath = Path.Combine(_installRoot, "PILOTPAPER-BUILD.txt");
        Directory.CreateDirectory(_runtimeDir);

        Text = "PilotPaper V1 — Validation K-par-K";
        StartPosition = FormStartPosition.CenterScreen;
        Width = 1460;
        Height = 930;
        MinimumSize = new Size(1080, 720);
        BackColor = Color.FromArgb(245, 246, 247);

        var iconPath = Path.Combine(_installRoot, "pilotpaper.ico");
        if (File.Exists(iconPath))
        {
            try { Icon = new Icon(iconPath); } catch { }
        }

        _webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
        Controls.Add(_webView);

        _startupPanel = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(247, 248, 249) };
        _startupTitle = new Label
        {
            Text = "PilotPaper V1",
            AutoSize = false,
            Width = 520,
            Height = 55,
            Font = new Font("Segoe UI", 27, FontStyle.Bold),
            ForeColor = Color.FromArgb(21, 39, 66),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        _startupDetail = new Label
        {
            Text = "Démarrage du moteur local…",
            AutoSize = false,
            Width = 520,
            Height = 34,
            Font = new Font("Segoe UI", 11, FontStyle.Regular),
            ForeColor = Color.FromArgb(104, 113, 125),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        _startupPanel.Controls.Add(_startupTitle);
        _startupPanel.Controls.Add(_startupDetail);
        _startupPanel.Resize += (_, _) => CenterStartupLabels();
        Controls.Add(_startupPanel);
        _startupPanel.BringToFront();

        Shown += async (_, _) => await StartAsync();
        FormClosing += OnClosing;
    }

    private void CenterStartupLabels()
    {
        var x = Math.Max(0, (_startupPanel.ClientSize.Width - _startupTitle.Width) / 2);
        var center = _startupPanel.ClientSize.Height / 2;
        _startupTitle.Location = new Point(x, Math.Max(50, center - 62));
        _startupDetail.Location = new Point(x, Math.Max(105, center + 1));
    }

    private async Task StartAsync()
    {
        try
        {
            CenterStartupLabels();
            EnsureInstalledPayload();
            EnsureOpenAiKey();
            EnsureGoogleSolarKey();
            SyncDevVarsToWorkerProject();
            _startupDetail.Text = "Démarrage du moteur local V1…";
            StartServer();
            if (!await WaitUntilReadyAsync(TimeSpan.FromMinutes(2)))
                throw new InvalidOperationException("Le moteur local n'a pas répondu dans le délai prévu.");

            _startupDetail.Text = "Ouverture de l'atelier DP1 → DP8…";
            var webViewData = Path.Combine(_runtimeDir, "webview2");
            var environment = await CoreWebView2Environment.CreateAsync(null, webViewData);
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            _webView.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            _webView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && uri.Host != "127.0.0.1")
                    Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
            };
            _webView.Source = new Uri(AppUrl);
            _webView.Visible = true;
            _startupPanel.Visible = false;
            _webView.Focus();
        }
        catch (Exception ex)
        {
            AppendLog($"START ERROR: {ex}");
            _startupTitle.Text = "PilotPaper n'a pas démarré";
            _startupDetail.Text = ex.Message;
            MessageBox.Show(
                $"PilotPaper V1 n'a pas pu démarrer.\n\n{ex.Message}\n\nJournal : {_logPath}",
                "PilotPaper V1",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void EnsureInstalledPayload()
    {
        var node = Path.Combine(_currentAppDir, "runtime", "node.exe");
        var vite = Path.Combine(_currentAppDir, "node_modules", "vite", "bin", "vite.js");
        var config = Path.Combine(_currentAppDir, "vite.config.ts");
        if (!File.Exists(node) || !File.Exists(vite) || !File.Exists(config))
            throw new InvalidOperationException("Le dossier V1 installé est incomplet. Réinstallez PilotPaper V1.");
    }

    private string VarsPath => Path.Combine(_installRoot, ".dev.vars");

    private string? ReadLocalVar(string name)
    {
        if (!File.Exists(VarsPath)) return null;
        var prefix = name + "=";
        var line = File.ReadAllLines(VarsPath)
            .FirstOrDefault(candidate => candidate.StartsWith(prefix, StringComparison.Ordinal));
        return line?.Split('=', 2).ElementAtOrDefault(1)?.Trim();
    }

    private void WriteLocalVar(string name, string value)
    {
        var prefix = name + "=";
        var lines = File.Exists(VarsPath)
            ? File.ReadAllLines(VarsPath).Where(line => !line.StartsWith(prefix, StringComparison.Ordinal)).ToList()
            : new List<string>();
        lines.Add($"{name}={value}");
        File.WriteAllLines(VarsPath, lines, new UTF8Encoding(false));
    }

    private string? PromptForLocalSecret(string title, string description, string saveLabel, string cancelLabel)
    {
        using var form = new Form
        {
            Text = title,
            Width = 590,
            Height = 250,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };
        var label = new Label
        {
            Left = 22, Top = 20, Width = 535, Height = 62,
            Text = description,
        };
        var input = new TextBox { Left = 22, Top = 88, Width = 535, UseSystemPasswordChar = true };
        var save = new Button { Text = saveLabel, Left = 405, Top = 136, Width = 152, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = cancelLabel, Left = 285, Top = 136, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, input, save, cancel]);
        form.AcceptButton = save;
        form.CancelButton = cancel;
        if (form.ShowDialog(this) != DialogResult.OK) return null;
        return input.Text.Trim();
    }

    private void EnsureOpenAiKey()
    {
        if (!string.IsNullOrWhiteSpace(ReadLocalVar("OPENAI_API_KEY"))) return;
        var key = PromptForLocalSecret(
            "PilotPaper V1 — Configuration OpenAI",
            "Clé API OpenAI du poste de test. Elle est enregistrée uniquement dans le dossier local PilotPaper V1 et n'est jamais envoyée dans GitHub.",
            "Enregistrer",
            "Annuler");
        if (string.IsNullOrWhiteSpace(key)) throw new OperationCanceledException("Configuration OpenAI annulée.");
        if (key.Length < 20 || key.Contains('\n') || key.Contains('\r')) throw new InvalidOperationException("La clé OpenAI saisie n'est pas valide.");
        WriteLocalVar("OPENAI_API_KEY", key);
    }

    private void EnsureGoogleSolarKey()
    {
        if (!string.IsNullOrWhiteSpace(ReadLocalVar("GOOGLE_SOLAR_API_KEY"))) return;
        var key = PromptForLocalSecret(
            "PilotPaper V1 — Google Solar API",
            "Clé Google Cloud avec Solar API activée et facturation associée. Elle permet le placement automatique des panneaux. La clé reste uniquement sur ce poste. Vous pouvez choisir Plus tard : le Roof Designer restera disponible.",
            "Activer l'AUTO",
            "Plus tard");
        if (string.IsNullOrWhiteSpace(key))
        {
            AppendLog("Google Solar API key not configured; DP2 automatic provider will use reviewed fallback.");
            return;
        }
        if (key.Length < 20 || key.Contains('\n') || key.Contains('\r')) throw new InvalidOperationException("La clé Google Solar API saisie n'est pas valide.");
        WriteLocalVar("GOOGLE_SOLAR_API_KEY", key);
    }

    private void SyncDevVarsToWorkerProject()
    {
        var persistentVars = Path.Combine(_installRoot, ".dev.vars");
        var workerVars = Path.Combine(_currentAppDir, ".dev.vars");
        if (!File.Exists(persistentVars)) throw new InvalidOperationException("Configuration locale PilotPaper introuvable.");
        File.Copy(persistentVars, workerVars, overwrite: true);
    }

    private void StartServer()
    {
        var node = Path.Combine(_currentAppDir, "runtime", "node.exe");
        var vite = Path.Combine(_currentAppDir, "node_modules", "vite", "bin", "vite.js");
        var varsPath = Path.Combine(_installRoot, ".dev.vars");
        var startInfo = new ProcessStartInfo
        {
            FileName = node,
            WorkingDirectory = _currentAppDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        startInfo.ArgumentList.Add(vite);
        startInfo.ArgumentList.Add("--host");
        startInfo.ArgumentList.Add("127.0.0.1");
        startInfo.ArgumentList.Add("--port");
        startInfo.ArgumentList.Add("5174");
        startInfo.ArgumentList.Add("--strictPort");

        startInfo.Environment["DP_TEST_EXPORT"] = "true";
        startInfo.Environment["DP_TEST_FAST"] = "false";
        startInfo.Environment["DP_MAX_RETRIES"] = "5";
        startInfo.Environment["DP_QA_PASS_SCORE"] = "0.96";
        startInfo.Environment["DP_REALISM_PASS_SCORE"] = "0.97";
        startInfo.Environment["NODE_ENV"] = "development";
        if (File.Exists(varsPath))
        {
            foreach (var line in File.ReadAllLines(varsPath))
            {
                var split = line.Split('=', 2);
                if (split.Length == 2 && !string.IsNullOrWhiteSpace(split[0]))
                    startInfo.Environment[split[0].Trim()] = split[1];
            }
        }

        _server = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _server.OutputDataReceived += (_, args) => AppendLog(args.Data);
        _server.ErrorDataReceived += (_, args) => AppendLog(args.Data);
        _server.Exited += (_, _) => { if (!_closing) BeginInvoke(() => _startupDetail.Text = "Le moteur local s'est arrêté. Consultez le journal."); };
        if (!_server.Start()) throw new InvalidOperationException("Impossible de lancer le moteur local PilotPaper.");
        _server.BeginOutputReadLine();
        _server.BeginErrorReadLine();
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var message = args.TryGetWebMessageAsString();
            if (message == "CHECK_UPDATE") await CheckForUpdateAsync();
        }
        catch (Exception ex)
        {
            AppendLog($"WEB MESSAGE ERROR: {ex}");
        }
    }

    private async Task CheckForUpdateAsync()
    {
        if (_updateInProgress) return;
        _updateInProgress = true;
        PostUpdateStatus("checking", "Vérification de la dernière V1…");
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("PilotPaper-V1-Updater/1.0");
            client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            using var releaseResponse = await client.GetAsync(ReleaseApiUrl);
            releaseResponse.EnsureSuccessStatusCode();
            var releaseJson = await releaseResponse.Content.ReadAsStringAsync();
            using var document = JsonDocument.Parse(releaseJson);
            var root = document.RootElement;
            var targetCommit = root.GetProperty("target_commitish").GetString()?.Trim() ?? "";

            string? downloadUrl = null;
            string? expectedDigest = null;
            foreach (var asset in root.GetProperty("assets").EnumerateArray())
            {
                if (!string.Equals(asset.GetProperty("name").GetString(), SetupAssetName, StringComparison.Ordinal)) continue;
                downloadUrl = asset.GetProperty("browser_download_url").GetString();
                if (asset.TryGetProperty("digest", out var digestElement)) expectedDigest = digestElement.GetString();
                break;
            }
            if (string.IsNullOrWhiteSpace(downloadUrl)) throw new InvalidOperationException("La release V1 ne contient pas l'installeur attendu.");

            var installedCommit = File.Exists(_buildMarkerPath) ? File.ReadAllText(_buildMarkerPath).Trim() : "";
            if (!string.IsNullOrWhiteSpace(installedCommit) && string.Equals(installedCommit, targetCommit, StringComparison.OrdinalIgnoreCase))
            {
                PostUpdateStatus("current", "PilotPaper V1 est à jour.");
                return;
            }

            PostUpdateStatus("available", "Une nouvelle V1 est disponible.");
            var choice = MessageBox.Show(
                this,
                "Une mise à jour PilotPaper V1 est disponible.\n\nElle ne sera installée que maintenant, à votre demande.\n\nTélécharger et installer ?",
                "Mise à jour PilotPaper",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Information);
            if (choice != DialogResult.Yes)
            {
                PostUpdateStatus("idle", "Mise à jour laissée en attente.");
                return;
            }

            PostUpdateStatus("downloading", "Téléchargement de la mise à jour…");
            var updatePath = Path.Combine(_runtimeDir, "PilotPaper-V1-Update.exe");
            if (File.Exists(updatePath)) File.Delete(updatePath);
            using (var downloadResponse = await client.GetAsync(downloadUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                downloadResponse.EnsureSuccessStatusCode();
                await using var input = await downloadResponse.Content.ReadAsStreamAsync();
                await using var output = File.Create(updatePath);
                await input.CopyToAsync(output);
            }

            if (!string.IsNullOrWhiteSpace(expectedDigest) && expectedDigest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
            {
                var expectedHex = expectedDigest[7..].Trim();
                await using var stream = File.OpenRead(updatePath);
                var actualHex = Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant();
                if (!string.Equals(actualHex, expectedHex, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(updatePath);
                    throw new InvalidOperationException("La signature SHA-256 de la mise à jour ne correspond pas à la release publiée.");
                }
            }

            PostUpdateStatus("installing", "Mise à jour vérifiée. Lancement de l'installeur…");
            AppendLog($"UPDATE installing target={targetCommit}");
            Process.Start(new ProcessStartInfo(updatePath) { UseShellExecute = true });
            BeginInvoke(Close);
        }
        catch (Exception ex)
        {
            AppendLog($"UPDATE ERROR: {ex}");
            PostUpdateStatus("error", "La mise à jour n'a pas pu être vérifiée.");
            MessageBox.Show(
                this,
                $"La mise à jour n'a pas pu être effectuée.\n\n{ex.Message}\n\nPilotPaper reste sur la version actuelle.",
                "Mise à jour PilotPaper",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
        finally
        {
            _updateInProgress = false;
        }
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
            await Task.Delay(700);
        }
        return false;
    }

    private void AppendLog(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try { File.AppendAllText(_logPath, $"{DateTime.Now:O} {line}{Environment.NewLine}"); } catch { }
    }

    private void OnClosing(object? sender, FormClosingEventArgs args)
    {
        if (_closing) return;
        _closing = true;
        try
        {
            if (_server is { HasExited: false }) _server.Kill(entireProcessTree: true);
        }
        catch { }
        try { _server?.Dispose(); } catch { }
        _server = null;
    }
}
