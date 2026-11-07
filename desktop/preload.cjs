// The only thing pages can ask the app for: try loading Cleanup again.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cleanupApp", { retry: () => ipcRenderer.invoke("cleanup:retry") });
