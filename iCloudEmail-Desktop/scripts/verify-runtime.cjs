'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const desktopDir = path.resolve(__dirname, '..');
const runtimeDir = path.join(desktopDir, '.runtime');
const serverDir = path.join(runtimeDir, 'server');
const nodeBin = path.join(runtimeDir, 'node', process.platform === 'win32' ? 'node.exe' : 'node');
const serverEntry = path.join(serverDir, 'dist', 'index.js');
const webDir = path.join(runtimeDir, 'web');

for (const required of [nodeBin, serverEntry, path.join(webDir, 'index.html')]) {
  if (!fs.existsSync(required)) throw new Error(`Missing runtime artifact: ${required}`);
}

function choosePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error('Could not reserve a smoke-test port'));
      });
    });
  });
}

function request(pathname, port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 1_500 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.once('timeout', () => req.destroy(new Error('request timeout')));
    req.once('error', reject);
  });
}

async function waitForServer(port, child, getChildError) {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (getChildError()) throw getChildError();
    if (child.exitCode !== null) throw new Error(`Runtime server exited with code ${child.exitCode}`);
    try {
      const health = await request('/health', port);
      const parsed = JSON.parse(health.body);
      if (health.status !== 200 || parsed.status !== 'ok' || parsed.name !== 'icloud-hme-manager') {
        throw new Error('unexpected health response');
      }
      const page = await request('/', port);
      if (page.status !== 200 || !page.body.includes('<div id="root"></div>')) {
        throw new Error('web UI was not served');
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error('Runtime server did not become ready');
}

function stopChild(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function main() {
  const port = await choosePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'icloud-email-runtime-'));
  const output = [];
  let childError = null;
  const child = spawn(nodeBin, [serverEntry], {
    cwd: serverDir,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: path.join(tempDir, 'smoke.sqlite'),
      PROFILES_DIR: path.join(tempDir, 'profiles'),
      WEB_DIST: webDir,
      SECRET_MASTER_KEY: crypto.randomBytes(32).toString('base64'),
      DISABLE_AUTH: 'true',
      SESSION_REFRESH_MINUTES: '0',
      MARK_SCAN_MINUTES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => output.push(chunk));
  child.stderr.on('data', (chunk) => output.push(chunk));
  child.once('error', (error) => {
    childError = error;
  });

  try {
    await waitForServer(port, child, () => childError);
    console.log(`Portable runtime verified (${process.platform}/${process.arch}, port ${port}).`);
  } catch (error) {
    const logs = Buffer.concat(output).toString('utf8').trim();
    if (logs) console.error(logs);
    throw error;
  } finally {
    await stopChild(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
