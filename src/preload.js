const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aeroChat", {
  platform: process.platform,
  installUpdate: (details) => ipcRenderer.invoke("install-update", details)
});
