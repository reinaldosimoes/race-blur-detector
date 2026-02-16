const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFolders: () => ipcRenderer.invoke("select-folders"),
  scanJpegs: (folderPath) => ipcRenderer.invoke("scan-jpegs", folderPath),
  scanMultipleFolders: (folders) => ipcRenderer.invoke("scan-multiple-folders", folders),
  readFileBase64: (filePath) => ipcRenderer.invoke("read-file-base64", filePath),
  validateJpeg: (filePath) => ipcRenderer.invoke("validate-jpeg", filePath),
  generateThumbnail: (filePath, maxDimension) => ipcRenderer.invoke("generate-thumbnail", filePath, maxDimension),
  moveToReview: (payload) => ipcRenderer.invoke("move-to-review", payload),
  selectOutputFolder: (defaultPath) => ipcRenderer.invoke("select-output-folder", defaultPath),
  showContextMenu: (filePath) => ipcRenderer.invoke("show-context-menu", filePath),
});
