const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pilotpaperKey", {
  submit(value) {
    ipcRenderer.send("pilotpaper-key-submit", String(value ?? ""));
  },
  cancel() {
    ipcRenderer.send("pilotpaper-key-cancel");
  },
});
