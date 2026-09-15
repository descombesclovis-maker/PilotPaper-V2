using System.Diagnostics;
using System.Net;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace PilotPaperLauncher;

internal static class PilotPaperV2Program
{
    private const string MutexName = "Local\\PilotPaper-V2-SingleInstance";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew) return;

        ApplicationConfiguration.Initialize();
        using var window = new PilotPaperV2Window();
        Application.Run(window);
        GC.KeepAlive(mutex);
    }
}

internal sealed class PilotPaperV2Window : Form
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
    private GeometryEngineSession? _geometrySession;

    public PilotPaperV2Window()
    {
        _currentAppDir = Path.Combine(_installRoot, "app", "current");
        _runtimeDir = Path.Combine(_installRoot, ".pilotpaper-runtime-v2");
        _logPath = Path.Combine(_runtimeDir, "pilotpaper-v2.log");
        Directory.CreateDirectory(_runtimeDir);

        Text = "PilotPaper V2";
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
            Text = "PilotPaper V2",
            AutoSize = false,
            Width = 620,
            Height = 58,
            Font = new Font("Segoe UI", 28, FontStyle.Bold),
            ForeColor = Color.FromArgb(21, 39, 66),
            TextAlign = ContentAlignment.MiddleCenter,
        };
        _startupDetail = new Label
        {
            Text = "Initialisation des moteurs documentaires…",
            AutoSize = false,
            Width = 620,
            Height = 38,
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

    private string VarsPath => Path.Combine(_installRoot, ".dev.vars");

    private void CenterStartupLabels()
    {
        var x = Math.Max(0, (_startupPanel.ClientSize.Width - _startupTitle.Width) / 2);
        var center = _startupPanel.ClientSize.Height / 2;
        _startupTitle.Location = new Point(x, Math.Max(50, center - 64));
        _startupDetail.Location = new Point(x, Math.Max(105, center + 2));
    }

    private async Task StartAsync()
    {
        try
        {
            CenterStartupLabels();
            EnsureInstalledPayload();
            EnsureVisualKey();

            _startupDetail.Text = "Connexion du moteur géométrique…";
            _geometrySession = await GeometryEngineCredentials.EnsureAsync(this, AppendLog);
            RemoveLegacyGeometrySecretsFromVars();
            SyncDevVarsToWorkerProject();

            _startupDetail.Text = "Démarrage de PilotPaper…";
            StartServer();
            if (!await WaitUntilReadyAsync(TimeSpan.FromMinutes(2)))
                throw new InvalidOperationException("Le moteur local PilotPaper n'a pas répondu dans le délai prévu.");

            _startupDetail.Text = "Ouverture de votre espace de travail…";
            var webViewData = Path.Combine(_runtimeDir, "webview2");
            var environment = await CoreWebView2Environment.CreateAsync(null, webViewData);
            await _webView.EnsureCoreWebView2Async(environment);
            _webView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
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
                this,
                $"PilotPaper V2 n'a pas pu démarrer.\n\n{ex.Message}\n\nJournal : {_logPath}",
                "PilotPaper V2",
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
            throw new InvalidOperationException("Le dossier PilotPaper V2 installé est incomplet. Réinstallez l'application.");
    }

    private string? ReadLocalVar(string name)
    {
        if (!File.Exists(VarsPath)) return null;
        var prefix = name + "=";
        var line = File.ReadAllLines(VarsPath).FirstOrDefault(candidate => candidate.StartsWith(prefix, StringComparison.Ordinal));
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

    private void EnsureVisualKey()
    {
        if (!string.IsNullOrWhiteSpace(ReadLocalVar("OPENAI_API_KEY"))) return;
        var key = PromptForLocalSecret(
            "PilotPaper V2 — Moteur visuel",
            "Saisissez la clé API utilisée par le moteur visuel. Elle reste uniquement sur ce poste.");
        if (string.IsNullOrWhiteSpace(key)) throw new OperationCanceledException("Configuration du moteur visuel annulée.");
        if (key.Length < 20 || key.Contains('\n') || key.Contains('\r')) throw new InvalidOperationException("La clé API saisie n'est pas valide.");
        WriteLocalVar("OPENAI_API_KEY", key);
    }

    private string? PromptForLocalSecret(string title, string description)
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
        var label = new Label { Left = 22, Top = 20, Width = 535, Height = 62, Text = description };
        var input = new TextBox { Left = 22, Top = 88, Width = 535, UseSystemPasswordChar = true };
        var save = new Button { Text = "Enregistrer", Left = 405, Top = 136, Width = 152, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Annuler", Left = 285, Top = 136, Width = 108, DialogResult = DialogResult.Cancel };
        form.Controls.AddRange([label, input, save, cancel]);
        form.AcceptButton = save;
        form.CancelButton = cancel;
        if (form.ShowDialog(this) != DialogResult.OK) return null;
        return input.Text.Trim();
    }

    private void RemoveLegacyGeometrySecretsFromVars()
    {
        if (!File.Exists(VarsPath)) return;
        var cleaned = File.ReadAllLines(VarsPath)
            .Where(line => !line.StartsWith("OPENSOLAR_", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        File.WriteAllLines(VarsPath, cleaned, new UTF8Encoding(false));
    }

    private void SyncDevVarsToWorkerProject()
    {
        if (!File.Exists(VarsPath)) throw new InvalidOperationException("Configuration locale PilotPaper introuvable.");
        File.Copy(VarsPath, Path.Combine(_currentAppDir, ".dev.vars"), overwrite: true);
    }

    private void StartServer()
    {
        var node = Path.Combine(_currentAppDir, "runtime", "node.exe");
        var vite = Path.Combine(_currentAppDir, "node_modules", "vite", "bin", "vite.js");
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
        startInfo.Environment["DP_IMAGE_MODEL"] = "gpt-image-2";
        startInfo.Environment["NODE_ENV"] = "development";

        if (File.Exists(VarsPath))
        {
            foreach (var line in File.ReadAllLines(VarsPath))
            {
                var split = line.Split('=', 2);
                if (split.Length == 2 && !string.IsNullOrWhiteSpace(split[0]))
                    startInfo.Environment[split[0].Trim()] = split[1];
            }
        }

        if (_geometrySession is not null)
        {
            startInfo.Environment["OPENSOLAR_ENABLED"] = "true";
            startInfo.Environment["OPENSOLAR_ORG_ID"] = _geometrySession.OrgId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            startInfo.Environment["OPENSOLAR_BEARER_TOKEN"] = _geometrySession.Token;
        }
        else
        {
            startInfo.Environment["OPENSOLAR_ENABLED"] = "false";
            startInfo.Environment.Remove("OPENSOLAR_ORG_ID");
            startInfo.Environment.Remove("OPENSOLAR_BEARER_TOKEN");
        }

        _server = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _server.OutputDataReceived += (_, args) => AppendLog(args.Data);
        _server.ErrorDataReceived += (_, args) => AppendLog(args.Data);
        _server.Exited += (_, _) =>
        {
            if (!_closing && !IsDisposed)
                BeginInvoke(() => _startupDetail.Text = "Le moteur local s'est arrêté. Consultez le journal.");
        };
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
        catch
        {
            return false;
        }
    }

    private static async Task<bool> WaitUntilReadyAsync(TimeSpan timeout)
    {
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (await IsReadyAsync()) return true;
            await Task.Delay(500);
        }
        return false;
    }

    private void AppendLog(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        try
        {
            Directory.CreateDirectory(_runtimeDir);
            File.AppendAllText(_logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {line}{Environment.NewLine}", Encoding.UTF8);
        }
        catch { }
    }

    private void OnClosing(object? sender, FormClosingEventArgs e)
    {
        _closing = true;
        try
        {
            if (_server is { HasExited: false }) _server.Kill(entireProcessTree: true);
        }
        catch { }
    }
}
