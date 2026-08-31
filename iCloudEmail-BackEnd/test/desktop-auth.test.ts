import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-desktop-auth-'));
process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.DISABLE_AUTH = 'true';
process.env.DESKTOP_INSTANCE_ID = 'desktop-launch-token';
process.env.SECRET_MASTER_KEY = 'desktop-auth-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');

const { buildServer } = await import('../src/api/server.js');
const { closeDb } = await import('../src/db/index.js');

const app = buildServer();
await app.ready();

test('desktop APIs require the per-launch HttpOnly cookie', async () => {
  const missing = await app.inject({ method: 'GET', url: '/api/overview' });
  assert.equal(missing.statusCode, 401);

  const wrong = await app.inject({
    method: 'GET',
    url: '/api/overview',
    headers: { cookie: 'icloud_hme_desktop=wrong' },
  });
  assert.equal(wrong.statusCode, 401);

  const valid = await app.inject({
    method: 'GET',
    url: '/api/overview',
    headers: { cookie: 'icloud_hme_desktop=desktop-launch-token' },
  });
  assert.equal(valid.statusCode, 200);
});

test('desktop mode does not leave first-key creation unauthenticated', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/apikeys',
    payload: { name: 'local-attacker' },
  });
  assert.equal(response.statusCode, 401);
});

test.after(async () => {
  await app.close();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
