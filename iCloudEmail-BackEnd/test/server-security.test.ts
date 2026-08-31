import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-server-security-'));
const webDist = join(dir, 'web');
mkdirSync(webDist);
writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>test ui</title>');

process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'server-security-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');
process.env.WEB_DIST = webDist;
process.env.DISABLE_AUTH = 'true';

const { buildServer, STATIC_UI_CSP } = await import('../src/api/server.js');
const { closeDb } = await import('../src/db/index.js');

const app = buildServer();
await app.ready();

function assertCommonSecurityHeaders(headers: Record<string, string | string[] | undefined>): void {
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.equal(headers['permissions-policy'], 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

test('API and health responses are protected from caching', async () => {
  for (const url of ['/api/config', '/api/missing', '/health']) {
    const response = await app.inject({ method: 'GET', url });
    assertCommonSecurityHeaders(response.headers);
    assert.equal(response.headers['cache-control'], 'no-store', url);
    assert.equal(response.headers['content-security-policy'], undefined, url);
  }
});

test('backend-served UI receives the aligned static content security policy', async () => {
  for (const url of ['/', '/client-route']) {
    const response = await app.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200, url);
    assertCommonSecurityHeaders(response.headers);
    assert.equal(response.headers['content-security-policy'], STATIC_UI_CSP, url);
    assert.match(STATIC_UI_CSP, /frame-src 'self'/);
    assert.match(STATIC_UI_CSP, /ws:\/\/localhost:\*/);
    assert.match(STATIC_UI_CSP, /https:\/\/api\.github\.com/);
  }
});

test.after(async () => {
  await app.close();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
