'use strict';
/*
 * Electron shell for the iCloud Hide My Email manager.
 *
 * better-sqlite3 is a native module compiled against Node's ABI, which differs
 * from Electron's — so the Fastify backend does not run inside the main process.
 * It is spawned as a child of a real Node runtime (found on PATH in dev, a copy
 * shipped in resources/ when packaged), and the BrowserWindow then loads the
 * same-origin UI that backend serves. All state lives under the userData dir.
 */
const { app, BrowserWindow, shell, Menu, clipboard, dialog, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
let serverProc = null;
let startupError = null;

// Packaged builds get this from productName, but a dev run would otherwise show
// the raw package name ("@icloud-hme/desktop") in the macOS menu bar and Dock.
// Note setName also moves the *default* userData path — harmless here only
// because the line below overrides that path explicitly.
app.setName('iCloud Email Manager');

// Keep development runs and installed builds on the same persistent data:
// %APPDATA%\@icloud-hme\desktop on Windows, ~/Library/Application Support/
// @icloud-hme/desktop on macOS. Neither an NSIS uninstall nor dragging the
// .app to the Trash removes this directory.
const stableUserData = path.join(app.getPath('appData'), '@icloud-hme', 'desktop');
app.setPath('userData', stableUserData);

function serverRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'server');
  return path.join(__dirname, '..', 'iCloudEmail-BackEnd');
}

/** Locate the built web UI (repo layout in dev, resources when packaged). */
function webDist() {
  const candidates = [
    path.join(__dirname, '..', 'iCloudEmail-FrontEnd', 'dist'),
    path.join(process.resourcesPath || '', 'web'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return candidates[0];
}

/** Build the child-server environment; persist a stable encryption key. */
function buildEnv() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const keyFile = path.join(userData, 'master.key');
  let key;
  if (fs.existsSync(keyFile)) {
    key = fs.readFileSync(keyFile, 'utf8').trim();
  } else {
    key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SECRET_MASTER_KEY: key,
    HOST,
    PORT: String(PORT),
    DATABASE_PATH: path.join(dataDir, 'icloud-hme.sqlite'),
    PROFILES_DIR: path.join(dataDir, 'profiles'),
    WEB_DIST: webDist(),
    // Desktop app is single-user & local — no API key required.
    DISABLE_AUTH: 'true',
    PLAYWRIGHT_CHANNEL:
      process.env.PLAYWRIGHT_CHANNEL ?? (IS_WIN ? 'msedge' : IS_MAC ? 'chrome' : ''),
  };
  return env;
}

/** First hit for `exe` on PATH, or null. */
function lookupOnPath(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Locate the Node runtime that runs the backend. Packaged builds ship their
 * own copy; otherwise we take PATH. On macOS/Linux a Finder/Dock launch gets a
 * bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) with no Homebrew or nvm in it, so
 * fall back to probing the usual install locations before giving up.
 */
function resolveNodeBin() {
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  const exe = IS_WIN ? 'node.exe' : 'node';
  const packaged = path.join(process.resourcesPath || '', 'node', exe);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const onPath = lookupOnPath(exe);
  if (onPath) return onPath;
  if (!IS_WIN) {
    for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return exe;
}

function startServer() {
  const entry = path.join(serverRoot(), 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`未找到后端构建产物：${entry}\n请先运行 "npm run build --workspace @icloud-hme/server"`);
  }
  const nodeBin = resolveNodeBin();
  // Without windowsHide, Windows pops up a separate console window for this
  // child process on every launch (node.exe is a console-subsystem binary).
  serverProc = spawn(nodeBin, [entry], {
    cwd: serverRoot(),
    env: buildEnv(),
    stdio: 'inherit',
    windowsHide: true,
  });
  serverProc.on('error', (err) => {
    startupError =
      err.code === 'ENOENT'
        ? `未找到 Node 运行时（${nodeBin}）。请安装 Node.js ≥ 20，或设置环境变量 NODE_BIN 指向 node 可执行文件。`
        : `后端进程启动失败：${err.message}`;
  });
  serverProc.on('exit', (code) => console.log(`[server] exited with code ${code}`));
}

function waitForHealth(timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tryOnce = () => {
      const req = http.get(`http://${HOST}:${PORT}/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        // A spawn failure (no Node runtime) is final — don't sit out the timeout.
        if (startupError) reject(new Error(startupError));
        else if (Date.now() > deadline) reject(new Error('后端启动超时'));
        else setTimeout(tryOnce, 400);
      });
    };
    tryOnce();
  });
}

/**
 * macOS keeps its menu bar no matter what, and dropping it there would also
 * drop ⌘C/⌘V/⌘Q. So: a native menu (roles only) on macOS, no menu bar at all
 * on Windows/Linux — where the shortcuts live in the window itself.
 */
function applyMenu(win) {
  if (!IS_MAC) {
    try {
      win.removeMenu();
    } catch {
      /* ignore */
    }
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
          { role: 'toggleDevTools', label: '开发者工具' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 920,
    // Stay hidden until the first paint is ready — otherwise the window shows
    // an empty white frame for a beat before the UI loads (the startup flash).
    show: false,
    title: 'iCloud Hide My Email 管理台',
    backgroundColor: '#0f1116',
    // Packaged macOS builds take their icon from the .app bundle (.icns); the
    // window-level icon is a Windows/Linux concept.
    ...(IS_MAC ? {} : { icon: path.join(__dirname, IS_WIN ? 'icon.ico' : 'icon.png') }),
    webPreferences: { contextIsolation: true },
  });
  win.once('ready-to-show', () => win.show());
  applyMenu(win);
  // Open external links (e.g. links inside a viewed email) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Right-click menu: works over links (incl. inside the email iframe) and text.
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.linkURL) {
      template.push({
        label: '在浏览器中打开链接',
        click: () => shell.openExternal(params.linkURL),
      });
      template.push({ label: '复制链接地址', click: () => clipboard.writeText(params.linkURL) });
    }
    if (params.selectionText) {
      if (template.length) template.push({ type: 'separator' });
      template.push({ label: '复制', role: 'copy' });
    }
    if (params.isEditable) {
      template.push({ label: '粘贴', role: 'paste' });
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });

  await win.loadURL(`http://${HOST}:${PORT}/`);
}

// A stable AppUserModelID makes Windows use our icon (not the generic
// electron.exe one) for the taskbar button and window grouping.
if (IS_WIN) app.setAppUserModelId('com.icloud-hme.desktop');

app.whenReady().then(async () => {
  // Unpackaged macOS runs (`npm run desktop`) show the stock Electron dock
  // icon; packaged .app bundles get theirs from Info.plist.
  if (IS_MAC && !app.isPackaged) {
    const image = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
    if (!image.isEmpty()) app.dock?.setIcon(image);
  }
  try {
    startServer();
    await waitForHealth();
  } catch (err) {
    startupError = startupError || (err instanceof Error ? err.message : String(err));
    console.error(err);
  }
  // Double-clicked app bundles have nowhere to print to, so surface the reason
  // instead of leaving the user with a blank "can't reach the server" window.
  if (startupError) {
    dialog.showErrorBox('iCloud Hide My Email 管理台启动失败', startupError);
  }
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS convention: the app stays in the Dock after the last window closes.
  if (!IS_MAC) app.quit();
});

app.on('quit', () => {
  if (serverProc) {
    try {
      // On POSIX the backend's SIGTERM handler stops the schedulers, closes
      // Fastify and closes SQLite before exiting (see BackEnd/src/index.ts).
      // Windows has no signals: Node ignores the name and calls TerminateProcess,
      // so the child dies immediately — SQLite's WAL is crash-safe either way.
      serverProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
});
