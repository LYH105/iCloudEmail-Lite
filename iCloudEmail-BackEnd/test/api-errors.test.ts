import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-api-errors-'));
process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'api-errors-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');

const { buildServer } = await import('../src/api/server.js');
const { closeDb } = await import('../src/db/index.js');
const app = buildServer();
app.get('/__test/internal-error', async () => {
  throw new Error('sensitive /Users/example/private.sqlite');
});
await app.ready();

test('malformed JSON is a safe structured 400 response', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/apikeys',
    headers: { 'content-type': 'application/json' },
    payload: '{broken',
  });
  const body = response.json();
  assert.equal(response.statusCode, 400);
  assert.equal(body.code, 'BAD_REQUEST');
  assert.equal(body.error, '请求格式无效');
  assert.equal(typeof body.requestId, 'string');
  assert.doesNotMatch(response.body, /Expected property|position 1/);
});

test('validation failures retain safe field details', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/apikeys',
    payload: { name: '' },
  });
  const body = response.json();
  assert.equal(response.statusCode, 400);
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.equal(body.error, '请求参数校验失败');
  assert.ok(body.details?.fieldErrors?.name);
});

test('unexpected errors do not expose internals', async () => {
  const response = await app.inject({ method: 'GET', url: '/__test/internal-error' });
  const body = response.json();
  assert.equal(response.statusCode, 500);
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.equal(body.error, '服务器内部错误');
  assert.doesNotMatch(response.body, /Users|private\.sqlite|sensitive/);
});

test.after(async () => {
  await app.close();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
