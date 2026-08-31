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
const { app, BrowserWindow, shell, Menu, clipboard, dialog, nativeImage, session } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');

const HOST = '127.0.0.1';
const DESKTOP_COOKIE_NAME = 'icloud_hme_desktop';
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
let serverProc = null;
let serverPort = null;
let serverReady = false;
let serverLogFd = null;
let serverLogPath = null;
let runtimeWebDir = null;
let instanceId = null;
let instanceMarker = null;
let mainWindow = null;
let startupError = null;
let isQuitting = false;

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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function serverRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'server');
  return path.join(__dirname, '..', 'iCloudEmail-BackEnd');
}

/** Locate the built web UI (repo layout in dev, resources when packaged). */
function sourceWebDist() {
  const candidates = [
    path.join(__dirname, '..', 'iCloudEmail-FrontEnd', 'dist'),
    path.join(process.resourcesPath || '', 'web'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return candidates[0];
}

/**
 * Copy the UI to a per-launch temporary directory and add a random marker.
 * The marker lets startup distinguish this exact backend from an unrelated
 * process that happened to answer on the selected loopback port.
 */
function prepareWebRuntime() {
  const source = sourceWebDist();
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    throw new Error(`未找到前端构建产物：${source}\n请先运行 "npm run build --workspace @icloud-hme/web"`);
  }
  const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'icloud-email-manager-'));
  runtimeWebDir = path.join(tempRoot, 'web');
  fs.cpSync(source, runtimeWebDir, { recursive: true });
  instanceId = crypto.randomUUID();
  instanceMarker = `desktop-instance-${crypto.randomBytes(16).toString('hex')}.json`;
  fs.writeFileSync(path.join(runtimeWebDir, instanceMarker), JSON.stringify({ status: 'ok', instanceId }), {
    mode: 0o600,
  });
}

function cleanupWebRuntime() {
  if (!runtimeWebDir) return;
  const tempRoot = path.dirname(runtimeWebDir);
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Windows may briefly retain a file handle while the child exits. The OS
    // temp directory is safe to clean on a later launch.
  }
  runtimeWebDir = null;
}

/** Build the child-server environment; persist a stable encryption key. */
function buildEnv() {
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const databasePath = path.join(dataDir, 'icloud-hme.sqlite');
  const keyFile = path.join(userData, 'master.key');
  let key;
  if (fs.existsSync(keyFile)) {
    key = fs.readFileSync(keyFile, 'utf8').trim();
    if (key.length < 16) {
      throw new Error(`加密主密钥无效：${keyFile}\n请从备份恢复 master.key 后再启动。`);
    }
  } else {
    let hasExistingDatabase = false;
    try {
      hasExistingDatabase = fs.statSync(databasePath).size > 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (hasExistingDatabase) {
      throw new Error(
        `检测到已有数据库，但加密主密钥缺失：${keyFile}\n` +
          '为避免用新密钥覆盖后造成数据不可恢复，应用已停止启动。请从同一份备份恢复 master.key。',
      );
    }
    key = crypto.randomBytes(32).toString('base64');
    fs.writeFileSync(keyFile, key, { mode: 0o600, flag: 'wx' });
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    SECRET_MASTER_KEY: key,
    HOST,
    PORT: String(serverPort),
    DATABASE_PATH: databasePath,
    PROFILES_DIR: path.join(dataDir, 'profiles'),
    WEB_DIST: runtimeWebDir,
    DESKTOP_INSTANCE_ID: instanceId,
    // Desktop app is single-user & local — no API key required.
    DISABLE_AUTH: 'true',
    PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL ?? (IS_WIN ? 'msedge' : IS_MAC ? 'chrome' : ''),
  };
  return env;
}

function chooseServerPort() {
  const configured = process.env.PORT;
  if (configured) {
    const parsed = Number(configured);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      return Promise.reject(new Error(`无效的 PORT：${configured}（必须是 1-65535 的整数）`));
    }
    return Promise.resolve(parsed);
  }

  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen({ host: HOST, port: 0, exclusive: true }, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('无法分配本地端口'));
        else resolve(port);
      });
    });
  });
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
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  serverLogPath = path.join(logDir, 'server.log');
  try {
    if (fs.statSync(serverLogPath).size > 2 * 1024 * 1024) {
      const previousLog = path.join(logDir, 'server.previous.log');
      fs.rmSync(previousLog, { force: true });
      fs.renameSync(serverLogPath, previousLog);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  serverLogFd = fs.openSync(serverLogPath, 'a', 0o600);
  fs.writeSync(
    serverLogFd,
    `\n[desktop ${new Date().toISOString()}] starting backend on ${HOST}:${serverPort}\n`,
  );
  // Without windowsHide, Windows pops up a separate console window for this
  // child process on every launch (node.exe is a console-subsystem binary).
  serverProc = spawn(nodeBin, [entry], {
    cwd: serverRoot(),
    env: buildEnv(),
    stdio: ['ignore', serverLogFd, serverLogFd],
    windowsHide: true,
  });
  serverProc.on('error', (err) => {
    startupError =
      err.code === 'ENOENT'
        ? `未找到 Node 运行时（${nodeBin}）。请安装 Node.js ≥ 22.12，或设置环境变量 NODE_BIN 指向 node 可执行文件。`
        : `后端进程启动失败：${err.message}`;
  });
  serverProc.on('exit', (code, signal) => {
    const message = `后端进程已退出（${signal ?? code ?? 'unknown'}）`;
    if (!serverReady) startupError = startupError || message;
    if (serverLogFd !== null) {
      try {
        fs.closeSync(serverLogFd);
      } catch {
        // Already closed during shutdown.
      }
      serverLogFd = null;
    }
    if (serverReady && !isQuitting) {
      dialog.showErrorBox('iCloud Email Manager', `${message}\n日志：${serverLogPath}`);
      app.quit();
    }
  });
}

function requestJson(pathname, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port: serverPort, path: pathname, timeout: timeoutMs }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 16_384) {
          req.destroy(new Error('健康检查响应过大'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`健康检查返回 HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('健康检查返回了无效 JSON'));
        }
      });
    });
    req.once('timeout', () => req.destroy(new Error('健康检查请求超时')));
    req.once('error', reject);
  });
}

async function waitForHealth(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() <= deadline) {
    if (startupError) throw new Error(startupError);
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(startupError || '后端进程在启动期间退出');
    }
    try {
      const health = await requestJson('/health');
      if (health?.status !== 'ok' || health?.name !== 'icloud-hme-manager') {
        throw new Error('本地端口上的服务身份不匹配');
      }
      const marker = await requestJson(`/${instanceMarker}`);
      if (marker?.status !== 'ok' || marker?.instanceId !== instanceId) {
        throw new Error('桌面实例身份校验失败');
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  const detail = lastError instanceof Error ? `：${lastError.message}` : '';
  throw new Error(`后端启动超时${detail}`);
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
  const viewMenu = [
    { role: 'reload', label: '重新加载' },
    { role: 'resetZoom', label: '实际大小' },
    { role: 'zoomIn', label: '放大' },
    { role: 'zoomOut', label: '缩小' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: '全屏' },
  ];
  if (!app.isPackaged) viewMenu.push({ role: 'toggleDevTools', label: '开发者工具' });

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
        submenu: viewMenu,
      },
      { role: 'windowMenu' },
    ]),
  );
}

function appOrigin() {
  return `http://${HOST}:${serverPort}`;
}

function isAppUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === appOrigin();
  } catch {
    return false;
  }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function openExternalUrl(rawUrl) {
  if (!isAllowedExternalUrl(rawUrl)) return;
  void shell.openExternal(rawUrl).catch((error) => {
    dialog.showErrorBox('无法打开链接', error instanceof Error ? error.message : String(error));
  });
}

function copyText(text) {
  try {
    const result = clipboard.writeText(text);
    if (result && typeof result.catch === 'function') {
      void result.catch((error) =>
        dialog.showErrorBox('无法复制', error instanceof Error ? error.message : String(error)),
      );
    }
  } catch (error) {
    dialog.showErrorBox('无法复制', error instanceof Error ? error.message : String(error));
  }
}

function configureSessionSecurity() {
  const allowedPermission = (permission, requestingOrigin) =>
    permission === 'clipboard-sanitized-write' && requestingOrigin === appOrigin();

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    allowedPermission(permission, requestingOrigin),
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let requestingOrigin = '';
    try {
      requestingOrigin = webContents.getURL() ? new URL(webContents.getURL()).origin : '';
    } catch {
      // Treat malformed or opaque origins as untrusted.
    }
    callback(allowedPermission(permission, requestingOrigin));
  });
}

async function installDesktopSessionCookie() {
  await session.defaultSession.cookies.set({
    url: appOrigin(),
    name: DESKTOP_COOKIE_NAME,
    value: instanceId,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'strict',
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 920,
    minWidth: 760,
    minHeight: 600,
    // Stay hidden until the first paint is ready — otherwise the window shows
    // an empty white frame for a beat before the UI loads (the startup flash).
    show: false,
    title: 'iCloud Hide My Email 管理台',
    backgroundColor: '#0f1116',
    // Packaged macOS builds take their icon from the .app bundle (.icns); the
    // window-level icon is a Windows/Linux concept.
    ...(IS_MAC ? {} : { icon: path.join(__dirname, IS_WIN ? 'icon.ico' : 'icon.png') }),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => win.show());
  applyMenu(win);
  // Open external links (e.g. links inside a viewed email) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  const guardNavigation = (event) => {
    if (isAppUrl(event.url)) return;
    event.preventDefault();
    openExternalUrl(event.url);
  };
  // `will-frame-navigate` also covers links clicked inside an email iframe, so
  // untrusted message content cannot turn a subframe into an embedded browser.
  win.webContents.on('will-frame-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  // Right-click menu: works over links (incl. inside the email iframe) and text.
  win.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.linkURL) {
      if (isAllowedExternalUrl(params.linkURL)) {
        template.push({
          label: '在浏览器中打开链接',
          click: () => openExternalUrl(params.linkURL),
        });
      }
      template.push({ label: '复制链接地址', click: () => copyText(params.linkURL) });
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

  await win.loadURL(`${appOrigin()}/`);
}

// A stable AppUserModelID makes Windows use our icon (not the generic
// electron.exe one) for the taskbar button and window grouping.
if (IS_WIN) app.setAppUserModelId('com.icloud-hme.desktop');

if (hasSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    // Unpackaged macOS runs (`npm run desktop`) show the stock Electron dock
    // icon; packaged .app bundles get theirs from Info.plist.
    if (IS_MAC && !app.isPackaged) {
      const image = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
      if (!image.isEmpty()) app.dock?.setIcon(image);
    }

    try {
      serverPort = await chooseServerPort();
      prepareWebRuntime();
      startServer();
      await waitForHealth();
      serverReady = true;
      configureSessionSecurity();
      await installDesktopSessionCookie();
      await createWindow();
    } catch (error) {
      startupError = startupError || (error instanceof Error ? error.message : String(error));
      const logHint = serverLogPath ? `\n\n日志：${serverLogPath}` : '';
      dialog.showErrorBox('iCloud Hide My Email 管理台启动失败', `${startupError}${logHint}`);
      app.quit();
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverReady) {
        void createWindow().catch((error) => {
          dialog.showErrorBox('无法打开窗口', error instanceof Error ? error.message : String(error));
        });
      }
    });
  });
}

app.on('window-all-closed', () => {
  // macOS convention: the app stays in the Dock after the last window closes.
  if (!IS_MAC) app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
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
  if (serverLogFd !== null) {
    try {
      fs.closeSync(serverLogFd);
    } catch {
      /* already closed */
    }
    serverLogFd = null;
  }
  cleanupWebRuntime();
});
