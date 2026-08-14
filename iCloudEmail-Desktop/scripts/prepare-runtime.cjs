'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(desktopDir, '..');
const runtimeDir = path.join(desktopDir, '.runtime');
const rootModules = path.join(rootDir, 'node_modules');

if (!runtimeDir.startsWith(`${desktopDir}${path.sep}`)) {
  throw new Error(`Unsafe runtime path: ${runtimeDir}`);
}
fs.rmSync(runtimeDir, { recursive: true, force: true });
fs.mkdirSync(runtimeDir, { recursive: true });

function copyDir(from, to) {
  if (!fs.existsSync(from)) throw new Error(`Missing build input: ${from}`);
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

// Built application assets.
// NB: the runtime/resources layout keeps the short names (server/, web/) —
// only the repo-side source directories are the renamed iCloudEmail-* ones.
const serverRuntime = path.join(runtimeDir, 'server');
copyDir(path.join(rootDir, 'iCloudEmail-BackEnd', 'dist'), path.join(serverRuntime, 'dist'));
fs.copyFileSync(
  path.join(rootDir, 'iCloudEmail-BackEnd', 'package.json'),
  path.join(serverRuntime, 'package.json'),
);
copyDir(path.join(rootDir, 'iCloudEmail-FrontEnd', 'dist'), path.join(runtimeDir, 'web'));

// Copy the exact installed production dependency tree, including native
// better-sqlite3 binaries, without pulling Electron's development packages.
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) throw new Error('Cannot locate npm CLI');
const dependencyPaths = execFileSync(
  process.execPath,
  [npmCli, 'ls', '--workspace', '@icloud-hme/server', '--omit=dev', '--all', '--parseable'],
  { cwd: rootDir, encoding: 'utf8', windowsHide: true },
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

for (const dependencyPath of dependencyPaths) {
  const absolute = path.resolve(dependencyPath);
  if (!absolute.startsWith(`${rootModules}${path.sep}`)) continue;
  const relative = path.relative(rootModules, absolute);
  if (relative === path.join('@icloud-hme', 'server')) continue;
  copyDir(absolute, path.join(serverRuntime, 'node_modules', relative));
}

// Ship the same Node runtime used to validate the native dependencies.
// NB: both this binary and better-sqlite3's are platform- (and arch-) specific,
// so a package must be built on the OS it targets — a Windows build cannot be
// produced on macOS, and vice versa.
const nodeDir = path.join(runtimeDir, 'node');
fs.mkdirSync(nodeDir, { recursive: true });
const nodeTarget = path.join(nodeDir, process.platform === 'win32' ? 'node.exe' : 'node');
fs.copyFileSync(process.execPath, nodeTarget);
if (process.platform !== 'win32') fs.chmodSync(nodeTarget, 0o755);

console.log(`Prepared portable runtime at ${runtimeDir}`);
