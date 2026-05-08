import { app, BrowserWindow, globalShortcut } from "electron";
import { join } from "path";
import { registerIpcHandlers } from "./ipc";
import { closeAllMcpClients } from "./mcp/client";
import { startWingsWatcher } from "./wingsWatcher";
import { cacheStore, orchestrator } from "./cache";

let mainWindow: BrowserWindow | null = null;
let wingsWatcher: { stop: () => void } | null = null;
let cacheUnsub: (() => void) | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
  wingsWatcher = startWingsWatcher(() => mainWindow);

  // Forward every cache event to the renderer. Single subscription for the
  // process lifetime — the listener tolerates a closed/replaced window.
  cacheUnsub = cacheStore.subscribe((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("cache:event", event);
    }
  });
  orchestrator.bootstrap();

  globalShortcut.register("CommandOrControl+Shift+O", () => {
    if (!mainWindow) {
      createWindow();
      return;
    }
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep app running on macOS even with no windows (accessible via global shortcut)
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  closeAllMcpClients();
  wingsWatcher?.stop();
  cacheUnsub?.();
  orchestrator.shutdown();
});
