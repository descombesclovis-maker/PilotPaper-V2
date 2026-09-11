using System.Diagnostics;
using System.IO.Pipes;
using System.Net;
using System.Text;
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
    private readonly string _installRoot = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private readonly string _currentAppDir;
    private readonly string _runtimeDir;
    private readonly string _logPath;
    private readonly WebView2 _webView;
    private readonly Panel _startupPanel;
    private readonly Label _startupTitle;
    private readonly Label _startupDetail;
    private Process? _server;
    private bool _closing;

    public PilotPaperWindow()
    {
        _currentAppDir = Path.Combine(_installRoot, "app", "current");
        _runtimeDir = Path.Combine(_installRoot, ".pilotpaper-runtime");
        _logPath = Path.Combine(_runtimeDir, "pilotpaper-v1.log");
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
            _webView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                // V1 is a single-window application. External links use the user's browser,
                // but PilotPaper itself can never clone its application window.
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
            Text = "PilotPaper V1 — Configuration locale",
            Width = 560,
            Height = 235,
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = false,
        };
        var label = new Label
        {
            Left = 22, Top = 20, Width = 500, Height = 48,
            Text = "Clé API OpenAI du poste de test. Elle est enregistrée uniquement dans le dossier local PilotPaper V1."
        };
        var input = new TextBox { Left = 22, Top = 78, Width = 500, UseSystemPasswordChar = true };
        var save = new Button { Text = "Enregistrer", Left = 382, Top = 124, Width = 140, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Annuler", Left = 270, Top = 124, Width = 100, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, input, save, cancel]);
        form.AcceptButton = save;
        form.CancelButton = cancel;
        if (form.ShowDialog(this) != DialogResult.OK) throw new OperationCanceledException("Configuration OpenAI annulée.");
        var key = input.Text.Trim();
        if (key.Length < 20 || key.Contains('\n') || key.Contains('\r')) throw new InvalidOperationException("La clé OpenAI saisie n'est pas valide.");
        File.WriteAllText(varsPath, $"OPENAI_API_KEY={key}{Environment.NewLine}", new UTF8Encoding(false));
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

        // V1 K-par-K exercises the complete quality chain but is never allowed
        // to claim production validation.
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
