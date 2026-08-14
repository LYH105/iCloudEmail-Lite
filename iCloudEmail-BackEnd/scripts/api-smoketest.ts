/*
 * End-to-end API smoke test using Fastify inject (no network port, no Apple
 * credentials). Verifies DB bootstrap, field encryption, API-key auth + scopes,
 * validation, and routing. Run: npx tsx scripts/api-smoketest.ts
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'smoke-test-master-key-0123456789';
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'ihme-')), 'test.sqlite');
process.env.LOG_LEVEL = 'error';

const { buildServer } = await import('../src/api/server.js');
const { getDb } = await import('../src/db/index.js');
getDb();
const app = buildServer();
await app.ready();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`, extra ?? '');
  }
}

// Health
let res = await app.inject({ method: 'GET', url: '/health' });
check('GET /health → 200', res.statusCode === 200);

// Bootstrap needed
res = await app.inject({ method: 'GET', url: '/api/apikeys/bootstrap' });
check('bootstrap needed initially', res.json().needsBootstrap === true);

// Protected route without key → 401
res = await app.inject({ method: 'GET', url: '/api/accounts' });
check('GET /api/accounts without key → 401', res.statusCode === 401);

// Create first key WITHOUT auth (bootstrap)
res = await app.inject({
  method: 'POST',
  url: '/api/apikeys',
  payload: { name: 'bootstrap' },
});
const fullKey: string = res.json().apiKey.key;
check('bootstrap key created (starts with ihme_)', fullKey?.startsWith('ihme_'));

// Bootstrap no longer needed
res = await app.inject({ method: 'GET', url: '/api/apikeys/bootstrap' });
check('bootstrap not needed after first key', res.json().needsBootstrap === false);

// Creating another key WITHOUT auth now → 401
res = await app.inject({ method: 'POST', url: '/api/apikeys', payload: { name: 'x' } });
check('second key without auth → 401', res.statusCode === 401);

const authH = { authorization: `Bearer ${fullKey}` };

// Authenticated list accounts → empty
res = await app.inject({ method: 'GET', url: '/api/accounts', headers: authH });
check('GET /api/accounts with key → 200 empty', res.statusCode === 200 && res.json().accounts.length === 0);

// Unknown account id → 404 (does not launch a browser)
res = await app.inject({ method: 'GET', url: '/api/accounts/does-not-exist', headers: authH });
check('GET unknown account → 404', res.statusCode === 404);

// Create a read-only key, then attempt a write → 403 (blocked before handler,
// so no browser is launched)
res = await app.inject({
  method: 'POST',
  url: '/api/apikeys',
  headers: authH,
  payload: { name: 'readonly', scopes: ['read'] },
});
const readKey: string = res.json().apiKey.key;
res = await app.inject({
  method: 'POST',
  url: '/api/accounts/login',
  headers: { authorization: `Bearer ${readKey}` },
  payload: { label: 'x' },
});
check('read-only key blocked from write → 403', res.statusCode === 403);

// Read with read-only key works
res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: `Bearer ${readKey}` } });
check('read-only key can read → 200', res.statusCode === 200);

// IMAP config create + list (exercises field encryption of password)
res = await app.inject({
  method: 'POST',
  url: '/api/imap',
  headers: authH,
  payload: { label: 'test', host: 'imap.mail.me.com', username: 'a@b.com', password: 'secret-pw' },
});
check('create imap config → 200', res.statusCode === 200);
res = await app.inject({ method: 'GET', url: '/api/imap', headers: authH });
const cfg = res.json().configs[0];
check('imap config listed without exposing password', cfg && !('password' in cfg) && cfg.username === 'a@b.com');

// Batch route: validation (count out of range) → 400
res = await app.inject({
  method: 'POST',
  url: '/api/accounts/some-id/aliases/batch',
  headers: authH,
  payload: { count: 0 },
});
check('batch with count=0 → 400', res.statusCode === 400);

// Batch route: read-only key blocked from write → 403
res = await app.inject({
  method: 'POST',
  url: '/api/accounts/some-id/aliases/batch',
  headers: { authorization: `Bearer ${readKey}` },
  payload: { count: 5 },
});
check('batch blocked for read-only key → 403', res.statusCode === 403);

// Empty body with application/json content-type must be tolerated (not 400)
res = await app.inject({
  method: 'POST',
  url: '/api/apikeys/nonexistent/revoke',
  headers: { ...authH, 'content-type': 'application/json' },
});
check('empty application/json body tolerated (not 400)', res.statusCode !== 400);

// Invalid API key rejected
res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: 'Bearer ihme_bogus' } });
check('bogus key → 401', res.statusCode === 401);

await app.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
