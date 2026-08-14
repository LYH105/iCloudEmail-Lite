/*
 * Run the backend and the web console side by side.
 *
 * `npm run dev:server & npm run dev:web` only works in a POSIX shell — on
 * Windows npm hands the script to cmd.exe, where `&` is a sequential separator,
 * so the web dev server would never start until the backend exits. Spawning
 * both from Node keeps one command working the same on macOS and Windows.
 */
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const workspaces = [
  { name: 'server', workspace: '@icloud-hme/server' },
  { name: 'web', workspace: '@icloud-hme/web' },
];

const children = workspaces.map(({ name, workspace }) => {
  const child = spawn(npm, ['run', 'dev', '--workspace', workspace], {
    stdio: 'inherit',
    // cmd.exe resolves npm.cmd through the shell; POSIX spawns npm directly.
    shell: isWindows,
    windowsHide: true,
  });
  child.on('error', (err) => {
    console.error(`[${name}] failed to start: ${err.message}`);
    shutdown(1);
  });
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited (${signal ?? code})`);
    // One half of the pair is useless on its own — take the other down too.
    shutdown(code ?? 0);
  });
  return child;
});

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill(isWindows ? undefined : 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  process.exitCode = code;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}
