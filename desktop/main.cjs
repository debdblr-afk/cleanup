// Cleanup for Mac. A window around the web app: your local copy when it's running on this
// Mac, otherwise the online site. Chromium inside, the same engine the tests use, so the
// in-browser cleaner and recorder behave exactly as tested.
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("node:path");

// Checked in order; the first that answers wins. CLEANUP_URL forces one.
const CANDIDATES = process.env.CLEANUP_URL ? [process.env.CLEANUP_URL] : ["http://localhost:5320", "https://cleanup.dbdd.in"];

let win = null;
let origin = null;

async function reachable(url) {
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2500), redirect: "manual" });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function pickUrl() {
  for (const url of CANDIDATES) if (await reachable(url)) return url;
  return null;
}

async function load() {
  const url = await pickUrl();
  if (!url) {
    origin = null;
    await win.loadFile(path.join(__dirname, "offline.html"), { query: { tried: CANDIDATES.join(" and ") } });
    return;
  }
  origin = new URL(url).origin;
  await win.loadURL(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    title: "Cleanup",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep rendering exports when the window is hidden or minimised (browsers throttle tabs).
      backgroundThrottling: false,
    },
  });

  const wc = win.webContents;
  // Links to other sites open in your default browser, never inside the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (origin && new URL(url).origin === origin) return;
    if (url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:/.test(url)) void shell.openExternal(url);
  });
  // The site went away (server stopped, connection lost): show the offline page.
  wc.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 /* aborted */ && !url.startsWith("file:")) void win.loadFile(path.join(__dirname, "offline.html"), { query: { tried: CANDIDATES.join(" and ") } });
  });
  void load();
}

ipcMain.handle("cleanup:retry", () => load());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // The app asks for nothing: no camera, microphone, location or notifications.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}
