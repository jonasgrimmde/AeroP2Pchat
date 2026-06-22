const { app, BrowserWindow, Menu, Tray, ipcMain, shell, session } = require("electron");
const { createWriteStream } = require("node:fs");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { get } = require("node:https");
const { tmpdir } = require("node:os");
const { basename, dirname, join } = require("node:path");
const { spawn } = require("node:child_process");

const windowIcon = process.platform === "win32"
  ? join(__dirname, "../../assets/app.ico")
  : join(__dirname, "../../assets/linux-icons/512x512.png");
const releaseHost = "github.com";
const releasePathPrefix = "/jonasgrimmde/AeroP2Pchat/releases/";
const configFileName = "config.json";
const allowMultipleInstances = process.env.AERO_CHAT_ALLOW_MULTI_INSTANCE === "1";
const autostartDesktopFileName = "aero-p2p-chat.desktop";
let mainWindow = null;
let tray = null;
let appConfig = {};
let forceQuit = false;

if (process.env.AERO_CHAT_USER_DATA_DIR) {
  app.setPath("userData", process.env.AERO_CHAT_USER_DATA_DIR);
}

if (!allowMultipleInstances) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", () => {
      if (!mainWindow) {
        return;
      }

      showMainWindow();
    });
  }
}

function getConfigPath() {
  return join(app.getPath("userData"), configFileName);
}

function getDefaultAppSettings() {
  return {
    autostart: false,
    startHidden: false,
    closeToTray: true
  };
}

function normalizeConfig(config = {}) {
  const settings = {
    ...getDefaultAppSettings(),
    ...(config.appSettings && typeof config.appSettings === "object" ? config.appSettings : {})
  };

  config.appSettings = {
    autostart: Boolean(settings.autostart),
    startHidden: Boolean(settings.startHidden),
    closeToTray: settings.closeToTray !== false
  };

  if (!config.appSettings.autostart) {
    config.appSettings.startHidden = false;
  }

  return config;
}

async function loadConfig() {
  try {
    return normalizeConfig(JSON.parse(await readFile(getConfigPath(), "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") {
      return normalizeConfig({});
    }
    throw error;
  }
}

async function saveConfig(config) {
  const normalizedConfig = normalizeConfig(config || {});
  const configPath = getConfigPath();
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, "utf8");
  appConfig = normalizedConfig;
  await applyAutostartSettings();
  return { ok: true, path: configPath };
}

function getAutostartArgs() {
  return appConfig.appSettings?.startHidden ? ["--hidden"] : [];
}

function getLinuxAutostartPath() {
  return join(app.getPath("home"), ".config", "autostart", autostartDesktopFileName);
}

function quoteDesktopValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function applyLinuxAutostartSettings() {
  const autostartPath = getLinuxAutostartPath();
  if (!appConfig.appSettings?.autostart) {
    await rm(autostartPath, { force: true });
    return;
  }

  const executable = process.env.APPIMAGE || process.execPath;
  const args = getAutostartArgs().map(quoteDesktopValue).join(" ");
  const desktopEntry = [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Aero P2P Chat",
    `Exec=${quoteDesktopValue(executable)}${args ? ` ${args}` : ""}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true"
  ].join("\n");

  await mkdir(dirname(autostartPath), { recursive: true });
  await writeFile(autostartPath, `${desktopEntry}\n`, "utf8");
}

async function applyAutostartSettings() {
  if (process.platform === "linux") {
    await applyLinuxAutostartSettings();
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: Boolean(appConfig.appSettings?.autostart),
    path: process.execPath,
    args: getAutostartArgs()
  });
}

function shouldStartHidden() {
  return process.argv.includes("--hidden");
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow({ hidden: false });
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "Open",
      click: showMainWindow
    },
    {
      label: "Close",
      click: () => {
        forceQuit = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  if (tray) {
    updateTrayMenu();
    return tray;
  }

  tray = new Tray(windowIcon);
  tray.setToolTip("Aero P2P Chat");
  tray.on("click", showMainWindow);
  updateTrayMenu();
  return tray;
}

function assertTrustedInstallerUrl(rawUrl) {
  const url = new URL(rawUrl);
  const isTrustedHost = url.hostname === releaseHost;
  const isTrustedPath = url.pathname.startsWith(releasePathPrefix);
  const isInstaller = basename(url.pathname) === "Aero-P2P-Chat-Windows-Setup.exe";

  if (!isTrustedHost || !isTrustedPath || !isInstaller) {
    throw new Error("Refused untrusted update URL.");
  }

  return url;
}

function downloadFile(url, targetPath, onProgress = () => {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error("Too many update download redirects."));
          return;
        }

        downloadFile(new URL(response.headers.location, url), targetPath, onProgress, redirects + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Update download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const file = createWriteStream(targetPath);
      const totalBytes = Number(response.headers["content-length"]) || 0;
      let receivedBytes = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (totalBytes > 0) {
          onProgress({
            phase: "download",
            percent: Math.min(100, Math.round((receivedBytes / totalBytes) * 100)),
            receivedBytes,
            totalBytes
          });
        } else {
          onProgress({
            phase: "download",
            percent: null,
            receivedBytes,
            totalBytes: null
          });
        }
      });

      response.pipe(file);
      file.on("finish", () => {
        onProgress({
          phase: "download",
          percent: 100,
          receivedBytes: totalBytes || receivedBytes,
          totalBytes: totalBytes || receivedBytes
        });
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function installWindowsUpdate(rawUrl, version, onProgress = () => {}) {
  if (process.platform !== "win32") {
    throw new Error("Setup updates are only available on Windows.");
  }
  if (!app.isPackaged) {
    throw new Error("Update install is only available in the packaged app.");
  }

  const url = assertTrustedInstallerUrl(rawUrl);
  const updateDir = await mkdtemp(join(tmpdir(), "aero-p2p-update-"));
  const setupPath = join(updateDir, `Aero-P2P-Chat-Setup-${version || "latest"}.exe`);
  const scriptPath = join(updateDir, "install-update.ps1");
  const appExePath = process.execPath;

  onProgress({ phase: "download", percent: 0, receivedBytes: 0, totalBytes: null });
  await downloadFile(url, setupPath, onProgress);
  onProgress({ phase: "install", percent: 100 });
  await writeFile(scriptPath, [
    "$ErrorActionPreference = 'Stop'",
    "Start-Sleep -Seconds 2",
    `$setup = ${JSON.stringify(setupPath)}`,
    `$app = ${JSON.stringify(appExePath)}`,
    "$args = @('/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CLOSEAPPLICATIONS')",
    "Start-Process -FilePath $setup -ArgumentList $args -Wait",
    "Start-Process -FilePath $app"
  ].join("\r\n"));

  const updater = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  updater.unref();

  setTimeout(() => app.quit(), 500);
  return { ok: true };
}

function createWindow({ hidden = false } = {}) {
  const win = new BrowserWindow({
    width: 760,
    height: 560,
    minWidth: 620,
    minHeight: 440,
    title: "Aero P2P Chat",
    icon: windowIcon,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#c5f2ff",
    autoHideMenuBar: true,
    show: !hidden,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow = win;
  win.on("close", (event) => {
    if (forceQuit || !appConfig.appSettings?.closeToTray) {
      return;
    }

    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
}

app.whenReady().then(async () => {
  appConfig = await loadConfig();
  await applyAutostartSettings();
  createTray();

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const requestingWindow = BrowserWindow.fromWebContents(webContents);
    callback(requestingWindow === mainWindow && permission === "media");
  });
  ipcMain.handle("install-update", (event, details) => installWindowsUpdate(details.url, details.version, (progress) => {
    event.sender.send("update-progress", progress);
  }));
  ipcMain.handle("load-config", () => loadConfig());
  ipcMain.handle("save-config", (_event, config) => saveConfig(config));
  ipcMain.handle("get-config-path", () => getConfigPath());
  ipcMain.handle("window-control", (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false };
    if (action === "minimize") win.minimize();
    if (action === "maximize") {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
    if (action === "close") win.close();
    return { ok: true, maximized: win.isMaximized() };
  });
  createWindow({ hidden: shouldStartHidden() });

  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (forceQuit || !appConfig.appSettings?.closeToTray) {
    app.quit();
  }
});
