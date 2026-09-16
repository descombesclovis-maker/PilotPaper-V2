const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chrome", {
  webview: {
    postMessage(message) {
      ipcRenderer.send("pilotpaper-web-message", message);
    },
    addEventListener(type, listener) {
      if (type !== "message" || typeof listener !== "function") return;
      ipcRenderer.on("pilotpaper-web-message", (_event, data) => listener({ data }));
    },
  },
});
