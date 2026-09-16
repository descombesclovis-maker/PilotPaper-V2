const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const APP_URL = "http://127.0.0.1:5174/";
const KEYCHAIN_SERVICE = "PilotPaper-V1-OpenAI-Key";
const KEYCHAIN_ACCOUNT = os.userInfo().username || "pilotpaper";
const BUILD_MARKER = "PILOTPAPER-MAC-BUILD.txt";

let mainWindow = null;
let serverProcess = null;
let quitting = false;
let logPath = null;
let runtimeAppDir = null;

app.setName("PilotPaper V1");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function appendLog(line) {
  if (!line || !logPath) return;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
  } catch {}
}

function readKeychainKey() {
  try {
    return execFileSync("/usr/bin/security", [
      "find-generic-password",
      "-s", KEYCHAIN_SERVICE,
      "-a", KEYCHAIN_ACCOUNT,
      "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function saveKeychainKey(value) {
  execFileSync("/usr/bin/security", [
    "add-generic-password",
    "-U",
    "-s", KEYCHAIN_SERVICE,
    "-a", KEYCHAIN_ACCOUNT,
    "-w", value,
  ], { stdio: "ignore" });
}

function validApiKey(value) {
  return typeof value === "string"
    && value.trim().length >= 20
    && !value.includes("\n")
    && !value.includes("\r");
}

function keyPromptHtml() {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f7f8fa;color:#16243a}
main{padding:26px}h1{font-size:22px;margin:0 0 12px}p{font-size:14px;line-height:1.45;color:#5d6775;margin:0 0 18px}
input{box-sizing:border-box;width:100%;padding:12px 13px;border:1px solid #c9cfd8;border-radius:9px;font-size:15px;background:#fff}
.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}button{padding:10px 16px;border-radius:9px;border:1px solid #c9cfd8;background:#fff;font-size:14px}button.primary{background:#162742;color:#fff;border-color:#162742}
</style></head><body><main><h1>PilotPaper V1</h1><p>Saisissez la clé API OpenAI utilisée par le moteur visuel. Elle sera enregistrée dans le Trousseau macOS et ne sera pas intégrée à l’application.</p>
<form id="form"><input id="key" type="password" autocomplete="off" autofocus placeholder="Clé API OpenAI"><div class="actions"><button type="button" id="cancel">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form></main>
<script>const key=document.getElementById('key');document.getElementById('form').addEventListener('submit',e=>{e.preventDefault();window.pilotpaperKey.submit(key.value)});document.getElementById('cancel').addEventListener('click',()=>window.pilotpaperKey.cancel());</script></body></html>`;
}

function promptForApiKey(parent) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("pilotpaper-key-submit", onSubmit);
      ipcMain.removeListener("pilotpaper-key-cancel", onCancel);
      if (!prompt.isDestroyed()) prompt.close();
      resolve(value);
    };
    const onSubmit = (_event, value) => finish(String(value ?? "").trim());
    const onCancel = () => finish(null);

    const prompt = new BrowserWindow({
      parent,
      modal: true,
      width: 590,
      height: 300,
      resizable: false,
      minimizable: false,
      maximizable: false,
      show: false,
      title: "PilotPaper V1 — Configuration",
      webPreferences: {
        preload: path.join(__dirname, "key-preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    ipcMain.on("pilotpaper-key-submit", onSubmit);
    ipcMain.on("pilotpaper-key-cancel", onCancel);
    prompt.on("closed", () => finish(null));
    prompt.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(keyPromptHtml())}`);
    prompt.once("ready-to-show", () => prompt.show());
  });
}

async function ensureApiKey(parent) {
  const stored = readKeychainKey();
  if (validApiKey(stored)) return stored.trim();

  while (true) {
    const value = await promptForApiKey(parent);
    if (value == null) throw new Error("Configuration OpenAI annulée.");
    if (!validApiKey(value)) {
      await dialog.showMessageBox(parent, {
        type: "warning",
        title: "PilotPaper V1",
        message: "La clé API saisie n’est pas valide.",
        detail: "Vérifiez la clé puis recommencez.",
      });
      continue;
    }
    saveKeychainKey(value.trim());
    return value.trim();
  }
}

function showStartup(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>body{margin:0;background:#f7f8fa;color:#162742;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:grid;place-items:center;height:100vh}.box{text-align:center}.title{font-size:34px;font-weight:750;margin-bottom:14px}.detail{font-size:15px;color:#697482}</style></head><body><div class="box"><div class="title">PilotPaper V1</div><div class="detail">${String(message).replace(/[<>&]/g, "")}</div></div></body></html>`;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function ensurePayload() {
  const template = path.join(process.resourcesPath, "app-template");
  const userData = app.getPath("userData");
  runtimeAppDir = path.join(userData, "app", "current");
  logPath = path.join(userData, "logs", "pilotpaper-v1.log");

  const templateMarkerPath = path.join(template, BUILD_MARKER);
  if (!fs.existsSync(templateMarkerPath)) throw new Error("Le package PilotPaper V1 macOS est incomplet.");
  const wantedMarker = fs.readFileSync(templateMarkerPath, "utf8").trim();
  const installedMarkerPath = path.join(runtimeAppDir, BUILD_MARKER);
  const installedMarker = fs.existsSync(installedMarkerPath)
    ? fs.readFileSync(installedMarkerPath, "utf8").trim()
    : "";
  const installedNode = path.join(runtimeAppDir, "runtime", "node");
  const installedVite = path.join(runtimeAppDir, "node_modules", "vite", "bin", "vite.js");

  if (installedMarker !== wantedMarker || !fs.existsSync(installedNode) || !fs.existsSync(installedVite)) {
    showStartup("Préparation de l’application pour ce Mac…");
    fs.rmSync(runtimeAppDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(runtimeAppDir), { recursive: true });
    fs.cpSync(template, runtimeAppDir, { recursive: true, force: true });
  }

  fs.chmodSync(installedNode, 0o755);
  return { node: installedNode, vite: installedVite };
}

function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, { timeout: 1800 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) return resolve();
        if (Date.now() >= deadline) return reject(new Error("PilotPaper n’a pas répondu dans le délai prévu."));
        setTimeout(attempt, 450);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => {
        if (Date.now() >= deadline) return reject(new Error("PilotPaper n’a pas répondu dans le délai prévu."));
        setTimeout(attempt, 450);
      });
    };
    attempt();
  });
}

function startServer(nodePath, vitePath, apiKey) {
  const env = {
    ...process.env,
    OPENAI_API_KEY: apiKey,
    DP_TEST_EXPORT: "true",
    DP_IMAGE_MODEL: "gpt-image-2",
    NODE_ENV: "development",
    WRANGLER_WRITE_LOGS: "false",
  };
  serverProcess = spawn(nodePath, [vitePath, "--host", "127.0.0.1", "--port", "5174", "--strictPort"], {
    cwd: runtimeAppDir,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout.on("data", (chunk) => appendLog(`SERVER: ${chunk.toString().trimEnd()}`));
  serverProcess.stderr.on("data", (chunk) => appendLog(`SERVER ERROR: ${chunk.toString().trimEnd()}`));
  serverProcess.on("exit", (code, signal) => {
    appendLog(`SERVER EXIT: code=${code} signal=${signal}`);
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "PilotPaper V1",
        message: "Le moteur local PilotPaper s’est arrêté.",
        detail: `Consultez le journal : ${logPath}`,
      });
    }
  });
}

function stopServer() {
  if (!serverProcess || serverProcess.killed) return;
  try {
    process.kill(-serverProcess.pid, "SIGTERM");
  } catch {
    try { serverProcess.kill("SIGTERM"); } catch {}
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 930,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f7f8fa",
    title: "PilotPaper V1",
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith("http://127.0.0.1:5174")) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  showStartup("Initialisation du moteur local…");
}

ipcMain.on("pilotpaper-web-message", (_event, message) => {
  if (message !== "CHECK_UPDATE" || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("pilotpaper-web-message", {
    type: "pilotpaper-update-status",
    status: "current",
    message: "PilotPaper V1 macOS est installé.",
  });
});

app.whenReady().then(async () => {
  const userData = path.join(app.getPath("appData"), "PilotPaper V1");
  app.setPath("userData", userData);
  createMainWindow();

  try {
    showStartup("Préparation de PilotPaper V1…");
    const payload = ensurePayload();
    const apiKey = await ensureApiKey(mainWindow);
    showStartup("Démarrage du moteur local…");
    startServer(payload.node, payload.vite, apiKey);
    await waitForUrl(APP_URL, 120000);
    await mainWindow.loadURL(APP_URL);
  } catch (error) {
    appendLog(`START ERROR: ${error?.stack || error}`);
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "PilotPaper V1",
      message: "PilotPaper V1 n’a pas pu démarrer.",
      detail: `${error?.message || error}\n\nJournal : ${logPath || "indisponible"}`,
    });
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  stopServer();
});
