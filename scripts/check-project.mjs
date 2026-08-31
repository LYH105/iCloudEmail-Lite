import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

const manifests = new Map([
  ['root', readJson('package.json')],
  ['server', readJson('iCloudEmail-BackEnd/package.json')],
  ['web', readJson('iCloudEmail-FrontEnd/package.json')],
  ['desktop', readJson('iCloudEmail-Desktop/package.json')],
]);
const lock = readJson('package-lock.json');
const lockPackages = lock.packages ?? {};
const expectedVersion = manifests.get('root').version;
const releaseTag = process.env.RELEASE_TAG;

for (const [name, manifest] of manifests) {
  check(
    manifest.version === expectedVersion,
    `${name} version is ${manifest.version}; expected ${expectedVersion}`,
  );
  check(manifest.engines?.node === '>=24', `${name} Node engine must remain >=24`);
}
if (releaseTag)
  check(releaseTag === `v${expectedVersion}`, `release tag ${releaseTag} must equal v${expectedVersion}`);

const workspacePaths = {
  server: 'iCloudEmail-BackEnd',
  web: 'iCloudEmail-FrontEnd',
  desktop: 'iCloudEmail-Desktop',
};
check(lockPackages['']?.version === expectedVersion, 'lockfile root version is out of sync');
for (const [name, relativePath] of Object.entries(workspacePaths)) {
  check(lockPackages[relativePath]?.version === expectedVersion, `lockfile ${name} version is out of sync`);
}

const targetNativePackages = [
  '@esbuild/darwin-arm64',
  '@esbuild/darwin-x64',
  '@esbuild/win32-x64',
  '@rollup/rollup-darwin-arm64',
  '@rollup/rollup-darwin-x64',
  '@rollup/rollup-win32-x64-msvc',
  '@tailwindcss/oxide-darwin-arm64',
  '@tailwindcss/oxide-darwin-x64',
  '@tailwindcss/oxide-win32-x64-msvc',
  'lightningcss-darwin-arm64',
  'lightningcss-darwin-x64',
  'lightningcss-win32-x64-msvc',
];

for (const packageName of targetNativePackages) {
  const suffix = `/node_modules/${packageName}`;
  const present = Object.keys(lockPackages).some(
    (path) => path === `node_modules/${packageName}` || path.endsWith(suffix),
  );
  check(present, `lockfile is missing native package ${packageName}`);
}

const electronVersion = manifests.get('desktop').devDependencies?.electron;
const sqliteRange = manifests.get('server').dependencies?.['better-sqlite3'];
check(
  lockPackages['node_modules/electron']?.version === electronVersion,
  'Electron lock version is out of sync',
);
check(
  lockPackages['node_modules/better-sqlite3']?.version === sqliteRange?.replace(/^[~^]/, ''),
  'better-sqlite3 lock version is out of sync',
);

if (failures.length) {
  console.error('Project metadata check failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Project metadata is consistent (version ${expectedVersion}; native lock matrix complete).`);
