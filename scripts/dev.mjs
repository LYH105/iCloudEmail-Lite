/* Run the backend and web console together with cross-platform process cleanup. */
import { existsSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const children = [];
let shuttingDown = false;
let requestedExitCode = 0;

function nodeVersionSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

function assertPrerequisites() {
  if (!nodeVersionSupported()) {
    throw new Error(`Node.js ${process.versions.node} 不受支持；请安装 Node.js 22.12 或更高版本。`);
  }
  for (const command of ['tsx', 'vite']) {
    const filename = isWindows ? `${command}.cmd` : command;
    if (!existsSync(join(root, 'node_modules', '.bin', filename))) {
      throw new Error(`缺少 ${command}。请先在项目根目录运行 npm install。`);
    }
  }
}

function assertBackendPortAvailable() {
  return new Promise((resolve, reject) => {
    const configured = Number(process.env.PORT || 8787);
    if (!Number.isInteger(configured) || configured < 1 || configured > 65_535) {
      reject(new Error(`PORT 必须是 1-65535 的整数，当前值为 ${process.env.PORT}`));
      return;
    }
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`开发端口 ${configured} 已被占用。请先退出已运行的服务或设置其他 PORT。`));
      } else {
        reject(error);
      }
    });
    probe.listen({ host: '127.0.0.1', port: configured, exclusive: true }, () => probe.close(resolve));
  });
}

function terminateTree(child, force = false) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  requestedExitCode = code;
  for (const child of children) terminateTree(child);

  const forceTimer = setTimeout(() => {
    for (const child of children) terminateTree(child, true);
  }, 3_000);
  forceTimer.unref();
}

function maybeFinish() {
  if (!shuttingDown || children.some((child) => child.exitCode === null)) return;
  process.exitCode = requestedExitCode;
}

try {
  assertPrerequisites();
  await assertBackendPortAvailable();
} catch (error) {
  console.error(`无法启动开发环境：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

for (const { name, workspace } of [
  { name: 'server', workspace: '@icloud-hme/server' },
  { name: 'web', workspace: '@icloud-hme/web' },
]) {
  const child = spawn(npm, ['run', 'dev', '--workspace', workspace], {
    cwd: root,
    stdio: 'inherit',
    shell: isWindows,
    windowsHide: true,
    detached: !isWindows,
  });
  children.push(child);
  child.on('error', (error) => {
    console.error(`[${name}] 启动失败：${error.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    console.log(`[${name}] 已退出（${signal ?? code}）`);
    if (!shuttingDown) shutdown(code === 0 ? 0 : 1);
    maybeFinish();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}
