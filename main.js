const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, Menu } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0e0e10",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Handler Logic (exported for testing) ─────────────────────

async function scanJpegs(folderPath) {
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const jpegs = [];
    for (const e of entries) {
      if (!e.isFile() || !/\.(jpe?g)$/i.test(e.name) || e.name.startsWith(".")) continue;
      try {
        const stat = await fs.promises.stat(path.join(folderPath, e.name));
        if (stat.size === 0) continue;
      } catch {
        continue;
      }
      jpegs.push({ name: e.name, path: path.join(folderPath, e.name) });
    }
    return jpegs;
  } catch (err) {
    return { error: err.message };
  }
}

async function readFileBase64(filePath) {
  try {
    const buf = await fs.promises.readFile(filePath);
    if (buf.length < 2 || buf[0] !== 0xFF || buf[1] !== 0xD8) {
      return { error: "not a valid JPEG" };
    }
    return buf.toString("base64");
  } catch (err) {
    return { error: err.message };
  }
}

async function validateJpeg(filePath) {
  try {
    const fd = await fs.promises.open(filePath, "r");
    const header = Buffer.alloc(2);
    await fd.read(header, 0, 2, 0);
    await fd.close();
    if (header[0] !== 0xFF || header[1] !== 0xD8) {
      return { valid: false, error: "not a valid JPEG" };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

async function scanMultipleFolders(folderPaths) {
  const results = [];
  for (const folder of folderPaths) {
    const jpegs = await scanJpegs(folder);
    if (Array.isArray(jpegs)) {
      results.push(...jpegs);
    }
  }
  return results;
}

function estimateScanTime(remainingFiles, avgMsPerFile) {
  const estimatedMs = remainingFiles * avgMsPerFile;
  let formatted;
  if (estimatedMs === 0) {
    formatted = "< 10 sec";
  } else if (estimatedMs < 10000) {
    formatted = "< 10 sec";
  } else if (estimatedMs < 45000) {
    formatted = "~30 sec";
  } else if (estimatedMs < 90000) {
    formatted = "~1 min";
  } else {
    const mins = Math.round(estimatedMs / 60000);
    formatted = `~${mins} min`;
  }
  return { estimatedMs, formatted };
}

function generateThumbnail(filePath, maxDimension) {
  try {
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) {
      return { error: "could not load image" };
    }
    const resized = img.resize({ width: maxDimension, height: maxDimension });
    return `data:image/png;base64,${resized.toPNG().toString("base64")}`;
  } catch (err) {
    return { error: err.message };
  }
}

// ── IPC Handlers ──────────────────────────────────────────────

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle("select-folders", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "multiSelections"],
  });
  if (result.canceled) return null;
  return result.filePaths;
});

ipcMain.handle("scan-jpegs", async (_event, folderPath) => scanJpegs(folderPath));

ipcMain.handle("scan-multiple-folders", async (_event, folderPaths) => scanMultipleFolders(folderPaths));

ipcMain.handle("read-file-base64", async (_event, filePath) => readFileBase64(filePath));

ipcMain.handle("validate-jpeg", async (_event, filePath) => validateJpeg(filePath));

ipcMain.handle("generate-thumbnail", async (_event, filePath, maxDimension) => generateThumbnail(filePath, maxDimension));

ipcMain.handle("select-output-folder", async (_event, defaultPath) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    defaultPath,
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

async function moveToReview({ files, sourceFolder, reviewFolderName, destFolder }) {
  const reviewDir = destFolder || path.join(sourceFolder, reviewFolderName || "review_blurry");
  if (!fs.existsSync(reviewDir)) {
    fs.mkdirSync(reviewDir, { recursive: true });
  }

  const results = [];
  for (const filePath of files) {
    try {
      const fileName = path.basename(filePath);
      const dest = path.join(reviewDir, fileName);
      fs.renameSync(filePath, dest);
      results.push({ file: fileName, success: true });
    } catch (err) {
      results.push({
        file: path.basename(filePath),
        success: false,
        error: err.message,
      });
    }
  }
  return { reviewDir, results };
}

ipcMain.handle("move-to-review", async (_event, args) => moveToReview(args));

ipcMain.handle("show-context-menu", async (_event, filePath) => {
  const menu = Menu.buildFromTemplate([
    {
      label: process.platform === "darwin" ? "Show in Finder" : "Show in Explorer",
      click: () => shell.showItemInFolder(filePath),
    },
  ]);
  menu.popup({ window: mainWindow });
});

module.exports = { scanJpegs, readFileBase64, validateJpeg, moveToReview, scanMultipleFolders, estimateScanTime, generateThumbnail };
