using System.Diagnostics;
using System.Net;
using System.Text;
using System.Windows.Forms;

namespace PilotPaperLauncher;

internal static class Program
{
    private const string AppUrl = "http://127.0.0.1:5173/";

    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new PilotPaperContext());
    }

    private sealed class PilotPaperContext : ApplicationContext
    {
        private readonly string _appRoot = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        private readonly string _runtimeDir;
        private readonly string _logPath;
        private readonly NotifyIcon _tray;
        private Process? _server;
        private bool _quitting;

        public PilotPaperContext()
        {
            _runtimeDir = Path.Combine(_appRoot, ".pilotpaper-runtime");
            Directory.CreateDirectory(_runtimeDir);
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

                if (await IsReadyAsync())
                {
                    OpenPilotPaper();
                    return;
                }

                StartServer();
                if (!await WaitUntilReadyAsync(TimeSpan.FromMinutes(2)))
                {
                    throw new InvalidOperationException("PilotPaper n'a pas démarré dans le délai prévu.");
                }

                OpenPilotPaper();
                _tray.ShowBalloonTip(2500, "PilotPaper", "PilotPaper est prêt.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                File.AppendAllText(_logPath, $"{DateTime.Now:O} START ERROR: {ex}\r\n");
                MessageBox.Show(
                    $"PilotPaper n'a pas pu démarrer.\n\n{ex.Message}\n\nJournal : {_logPath}",
                    "PilotPaper",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Quit();
            }
        }

        private void EnsureOpenAiKey()
        {
            var varsPath = Path.Combine(_appRoot, ".dev.vars");
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

            var label = new Label
            {
                Left = 20,
                Top = 20,
                Width = 460,
                Height = 42,
                Text = "Colle ta clé API OpenAI. Elle reste uniquement sur ce PC.",
            };
            var input = new TextBox
            {
                Left = 20,
                Top = 72,
                Width = 460,
                UseSystemPasswordChar = true,
            };
            var save = new Button
            {
                Text = "Enregistrer et démarrer",
                Left = 275,
                Top = 112,
                Width = 205,
                DialogResult = DialogResult.OK,
            };
            var cancel = new Button
            {
                Text = "Annuler",
                Left = 175,
                Top = 112,
                Width = 90,
                DialogResult = DialogResult.Cancel,
            };

            form.Controls.AddRange([label, input, save, cancel]);
            form.AcceptButton = save;
            form.CancelButton = cancel;

            if (form.ShowDialog() != DialogResult.OK)
                throw new OperationCanceledException("Configuration OpenAI annulée.");

            var key = input.Text.Trim();
            if (key.Length < 20 || key.Contains('\n') || key.Contains('\r'))
                throw new InvalidOperationException("La clé OpenAI saisie n'est pas valide.");

            File.WriteAllText(varsPath, $"OPENAI_API_KEY={key}{Environment.NewLine}", new UTF8Encoding(false));
        }

        private void StartServer()
        {
            var node = Path.Combine(_appRoot, "runtime", "node.exe");
            var vite = Path.Combine(_appRoot, "node_modules", "vite", "bin", "vite.js");
            if (!File.Exists(node)) throw new FileNotFoundException("Runtime Node embarqué introuvable.", node);
            if (!File.Exists(vite)) throw new FileNotFoundException("Runtime Vite embarqué introuvable.", vite);

            var psi = new ProcessStartInfo
            {
                FileName = node,
                WorkingDirectory = _appRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add(vite);
            psi.ArgumentList.Add("--host");
            psi.ArgumentList.Add("127.0.0.1");
            psi.ArgumentList.Add("--port");
            psi.ArgumentList.Add("5173");
            psi.ArgumentList.Add("--strictPort");

            psi.Environment["DP_TEST_EXPORT"] = "false";
            psi.Environment["DP_TEST_FAST"] = "false";
            psi.Environment["DP_MAX_RETRIES"] = "5";
            psi.Environment["NODE_ENV"] = "development";

            _server = new Process { StartInfo = psi, EnableRaisingEvents = true };
            _server.OutputDataReceived += (_, e) => AppendLog(e.Data);
            _server.ErrorDataReceived += (_, e) => AppendLog(e.Data);
            _server.Exited += (_, _) =>
            {
                if (!_quitting)
                    AppendLog($"Server exited with code {_server?.ExitCode}");
            };

            if (!_server.Start()) throw new InvalidOperationException("Impossible de lancer le moteur PilotPaper.");
            _server.BeginOutputReadLine();
            _server.BeginErrorReadLine();
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

        private static void OpenPilotPaper()
        {
            Process.Start(new ProcessStartInfo(AppUrl) { UseShellExecute = true });
        }

        private void OpenLog()
        {
            if (!File.Exists(_logPath)) File.WriteAllText(_logPath, "PilotPaper desktop log\r\n");
            Process.Start(new ProcessStartInfo(_logPath) { UseShellExecute = true });
        }

        private void Quit()
        {
            if (_quitting) return;
            _quitting = true;
            try
            {
                if (_server is { HasExited: false }) _server.Kill(entireProcessTree: true);
            }
            catch { }
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
}
