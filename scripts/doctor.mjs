import { accessSync, constants, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const serverRequire = createRequire(join(root, 'iCloudEmail-BackEnd', 'package.json'));
const webRequire = createRequire(join(root, 'iCloudEmail-FrontEnd', 'package.json'));
const desktopRequire = createRequire(join(root, 'iCloudEmail-Desktop', 'package.json'));
let errors = 0;
let warnings = 0;

function result(level, message) {
  const prefix = level === 'ok' ? '✓' : level === 'warn' ? '!' : '✗';
  console.log(`${prefix} ${message}`);
  if (level === 'warn') warnings++;
  if (level === 'error') errors++;
}

function versionTuple(value) {
  return value.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function atLeast(value, minimum) {
  const current = versionTuple(value);
  const target = versionTuple(minimum);
  for (let index = 0; index < Math.max(current.length, target.length); index++) {
    if ((current[index] ?? 0) > (target[index] ?? 0)) return true;
    if ((current[index] ?? 0) < (target[index] ?? 0)) return false;
  }
  return true;
}

console.log('iCloud Email Manager environment check\n');

result(
  atLeast(process.versions.node, '22.12.0') ? 'ok' : 'error',
  `Node.js ${process.versions.node}${atLeast(process.versions.node, '22.12.0') ? '' : ' (22.12+ required)'}`,
);

const supportedPlatform = process.platform === 'darwin' || process.platform === 'win32';
result(supportedPlatform ? 'ok' : 'warn', `${process.platform}/${process.arch} host`);

for (const [dependency, workspaceRequire] of [
  ['electron', desktopRequire],
  ['typescript', serverRequire],
  ['vite', webRequire],
  ['playwright', serverRequire],
]) {
  try {
    const manifest = workspaceRequire(`${dependency}/package.json`);
    result('ok', `${dependency} ${manifest.version}`);
  } catch {
    result('error', `${dependency} is not installed; run npm install`);
  }
}

try {
  const Database = serverRequire('better-sqlite3');
  const database = new Database(':memory:');
  const row = database.prepare('SELECT sqlite_version() AS version').get();
  database.close();
  result('ok', `better-sqlite3 native binding (SQLite ${row.version})`);
} catch (error) {
  result('error', `better-sqlite3 native binding failed: ${error instanceof Error ? error.message : error}`);
}

const expectedBuilds = [
  ['server build', join(root, 'iCloudEmail-BackEnd', 'dist', 'index.js')],
  ['web build', join(root, 'iCloudEmail-FrontEnd', 'dist', 'index.html')],
];
for (const [label, path] of expectedBuilds) {
  result(
    existsSync(path) ? 'ok' : 'warn',
    `${label}${existsSync(path) ? '' : ' is absent; run npm run build'}`,
  );
}

const browserCandidates =
  process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32'
      ? [
          join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : [];
if (browserCandidates.length) {
  const browser = browserCandidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  result(
    browser ? 'ok' : 'warn',
    browser
      ? `system browser found (${browser})`
      : 'default Chrome/Edge channel not found; login still works, but browser-assisted session refresh will not',
  );
}

console.log(`\n${errors} error(s), ${warnings} warning(s)`);
process.exitCode = errors === 0 ? 0 : 1;
