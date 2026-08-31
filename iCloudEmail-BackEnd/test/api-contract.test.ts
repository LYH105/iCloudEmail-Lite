import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-api-contract-'));
process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'api-contract-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');

const { buildServer } = await import('../src/api/server.js');
const { desktopCookieMatches } = await import('../src/api/auth.js');
const { encryptSecret } = await import('../src/crypto/secrets.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { createApiKey } = await import('../src/services/apiKeyService.js');

const db = getDb();
const now = Date.now();
const insertAccount = db.prepare(
  `INSERT INTO accounts (
     id, label, apple_id, client_id, status, disabled, login_password_enc,
     trust_token_enc, created_at, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
insertAccount.run(
  'account-active',
  'Active',
  'active@example.test',
  'client-active',
  'active',
  0,
  encryptSecret('saved-password'),
  encryptSecret('saved-trust-token'),
  now,
  now,
);
insertAccount.run(
  'account-attention',
  'Attention',
  'attention@example.test',
  'client-attention',
  'session_expired',
  0,
  null,
  null,
  now + 1,
  now + 1,
);
insertAccount.run(
  'account-paused',
  'Paused',
  'paused@example.test',
  'client-paused',
  'active',
  1,
  null,
  null,
  now + 2,
  now + 2,
);

db.prepare(
  `INSERT INTO imap_configs (
     id, account_id, label, host, port, secure, username, password_enc, created_at, updated_at
   ) VALUES (?, ?, ?, ?, 993, 1, ?, ?, ?, ?)`,
).run(
  'imap-active',
  'account-active',
  'Active',
  'imap.example.test',
  'active@example.test',
  encryptSecret('imap-password'),
  now,
  now,
);

const insertAlias = db.prepare(
  `INSERT INTO aliases (
     id, account_id, anonymous_id, hme, is_active, synced_at, used, used_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
insertAlias.run('alias-1', 'account-active', 'anon-1', 'one@icloud.com', 1, now, 1, now);
insertAlias.run('alias-2', 'account-attention', 'anon-2', 'two@icloud.com', 0, now, 0, null);
db.prepare('INSERT INTO alias_mark_hits (alias_id, mark, hit_at, source) VALUES (?, ?, ?, ?)').run(
  'alias-1',
  '已注册',
  now,
  'test',
);

const readKey = createApiKey('read-only', ['read']).key;
const writeKey = createApiKey('write-only', ['write']).key;
const auth = (key: string) => ({ authorization: `Bearer ${key}` });
const app = buildServer();
await app.ready();

test('desktop session cookie comparison is exact and handles encoded values', () => {
  assert.equal(desktopCookieMatches('other=1; icloud_hme_desktop=launch-token', 'launch-token'), true);
  assert.equal(desktopCookieMatches('icloud_hme_desktop=wrong', 'launch-token'), false);
  assert.equal(desktopCookieMatches(undefined, 'launch-token'), false);
});

test('overview is local, aggregated, and read-scope protected', async () => {
  const unauthenticated = await app.inject({ method: 'GET', url: '/api/overview' });
  assert.equal(unauthenticated.statusCode, 401);

  const forbidden = await app.inject({
    method: 'GET',
    url: '/api/overview',
    headers: auth(writeKey),
  });
  assert.equal(forbidden.statusCode, 403);

  const response = await app.inject({
    method: 'GET',
    url: '/api/overview',
    headers: auth(readKey),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    accounts: { total: 3, active: 1, needsAttention: 1, withImap: 1, paused: 1 },
    aliases: { total: 2, active: 1, used: 1, marked: 1 },
    setup: { hasAccount: true, hasActiveAccount: true, hasMailbox: true },
    jobs: { sessionRefreshMinutes: 180, markScanMinutes: 30 },
  });
});

test('operations that mutate cache or connection status require write scope', async () => {
  for (const url of [
    '/api/accounts/account-active/aliases/sync',
    '/api/accounts/account-active/imap/test',
    '/api/imap/imap-active/test',
  ]) {
    const response = await app.inject({ method: 'POST', url, headers: auth(readKey) });
    assert.equal(response.statusCode, 403, url);
  }
});

test('account settings can securely clear the saved Apple credential', async () => {
  const forbidden = await app.inject({
    method: 'POST',
    url: '/api/accounts/account-active/settings',
    headers: auth(readKey),
    payload: { clearLoginPassword: true },
  });
  assert.equal(forbidden.statusCode, 403);

  const response = await app.inject({
    method: 'POST',
    url: '/api/accounts/account-active/settings',
    headers: auth(writeKey),
    payload: { clearLoginPassword: true },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().account.hasPassword, false);
  const stored = db
    .prepare('SELECT login_password_enc, trust_token_enc FROM accounts WHERE id = ?')
    .get('account-active') as { login_password_enc: string | null; trust_token_enc: string | null };
  assert.deepEqual(stored, { login_password_enc: null, trust_token_enc: null });
});

test('a lost verification flow without a saved password gives a clear recovery path', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/accounts/account-active/resume-code',
    headers: auth(writeKey),
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'CONFLICT');
  assert.match(response.json().error, /未保存 Apple ID 密码.*重新输入密码登录/);
});

test('clearLoginPassword is strictly validated', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/accounts/account-active/settings',
    headers: auth(writeKey),
    payload: { clearLoginPassword: 'yes' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, 'VALIDATION_ERROR');
});

test('login password consent is optional and strictly validated', async () => {
  const invalidLogin = await app.inject({
    method: 'POST',
    url: '/api/accounts/login',
    headers: auth(writeKey),
    payload: {
      appleId: 'person@example.test',
      password: 'secret',
      china: true,
      rememberPassword: 'yes',
    },
  });
  assert.equal(invalidLogin.statusCode, 400);
  assert.equal(invalidLogin.json().code, 'VALIDATION_ERROR');

  const invalidRelogin = await app.inject({
    method: 'POST',
    url: '/api/accounts/account-active/relogin',
    headers: auth(writeKey),
    payload: { rememberPassword: 'yes' },
  });
  assert.equal(invalidRelogin.statusCode, 400);
  assert.equal(invalidRelogin.json().code, 'VALIDATION_ERROR');
});

test('the final active write API key cannot be revoked or deleted', async () => {
  for (const operation of [
    { method: 'POST' as const, url: `/api/apikeys/${createApiKey('temporary-read', ['read']).id}/revoke` },
    { method: 'POST' as const, url: `/api/apikeys/${createApiKey('temporary-write', ['write']).id}/revoke` },
  ]) {
    // The temporary write key means revoking it is safe while writeKey remains.
    const response = await app.inject({ ...operation, headers: auth(writeKey) });
    assert.equal(response.statusCode, 200);
  }

  const writeRow = db
    .prepare('SELECT id FROM api_keys WHERE key_hash = ?')
    .get((await import('../src/crypto/secrets.js')).sha256Hex(writeKey)) as { id: string };
  const revoke = await app.inject({
    method: 'POST',
    url: `/api/apikeys/${writeRow.id}/revoke`,
    headers: auth(writeKey),
  });
  assert.equal(revoke.statusCode, 409);
  assert.match(revoke.json().error, /最后一个有效/);

  const remove = await app.inject({
    method: 'DELETE',
    url: `/api/apikeys/${writeRow.id}`,
    headers: auth(writeKey),
  });
  assert.equal(remove.statusCode, 409);
});

test('bootstrap recovers a legacy database that has only revoked or read-only keys', async () => {
  // Simulate legacy state created before the last-writer guard existed.
  db.exec("UPDATE api_keys SET revoked = 1 WHERE (',' || scopes || ',') LIKE '%,write,%'");
  const status = await app.inject({ method: 'GET', url: '/api/apikeys/bootstrap' });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().needsBootstrap, true);

  const recovered = await app.inject({
    method: 'POST',
    url: '/api/apikeys',
    payload: { name: 'recovery-key' },
  });
  assert.equal(recovered.statusCode, 200);
  assert.match(recovered.json().apiKey.key, /^ihme_/);
});

test.after(async () => {
  await app.close();
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
