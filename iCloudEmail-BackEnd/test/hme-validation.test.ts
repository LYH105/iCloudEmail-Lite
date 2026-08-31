import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-hme-validation-'));
process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'hme-validation-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');

const { encryptSecret } = await import('../src/crypto/secrets.js');
const { closeDb, getDb } = await import('../src/db/index.js');
const { HmeClient } = await import('../src/icloud/hme.js');
const { sync } = await import('../src/services/aliasService.js');

const db = getDb();
const now = Date.now();
db.prepare(
  `INSERT INTO accounts (
     id, label, apple_id, dsid, webservice_url, client_id, status, cookie_enc,
     created_at, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
).run(
  'account-1',
  'Account',
  'owner@example.test',
  '12345',
  'https://p-mailws.example.test',
  'client-1',
  encryptSecret('session-cookie'),
  now,
  now,
);
db.prepare(
  `INSERT INTO aliases (id, account_id, anonymous_id, hme, is_active, synced_at, used)
   VALUES (?, ?, ?, ?, 1, ?, 1)`,
).run('alias-1', 'account-1', 'anonymous-1', 'keep@icloud.com', now);
db.prepare('INSERT INTO alias_mark_hits (alias_id, mark, hit_at, source) VALUES (?, ?, ?, ?)').run(
  'alias-1',
  '已注册',
  now,
  'existing state',
);

const originalFetch = globalThis.fetch;
const session = {
  cookie: 'session-cookie',
  webserviceUrl: 'https://p-mailws.example.test',
  dsid: '12345',
  clientId: 'client-1',
};

test('an anomalous successful list response is rejected', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, result: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  await assert.rejects(
    () => new HmeClient(session).list(),
    (error: unknown) =>
      (error as { status?: number }).status === 502 &&
      /\u672a\u4fee\u6539\u672c\u5730\u6570\u636e/.test((error as Error).message),
  );
});

test('sync preserves aliases, marks, and used state when wire validation fails', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ success: true, result: { selectedForwardTo: '' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  await assert.rejects(() => sync('account-1'));
  const alias = db.prepare('SELECT used FROM aliases WHERE id = ?').get('alias-1') as
    { used: number } | undefined;
  const hit = db.prepare('SELECT mark FROM alias_mark_hits WHERE alias_id = ?').get('alias-1') as
    { mark: string } | undefined;
  assert.deepEqual(alias, { used: 1 });
  assert.deepEqual(hit, { mark: '已注册' });
});

test('a structurally valid empty list remains a valid authoritative result', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: { hmeEmails: [], selectedForwardTo: '', forwardToEmails: [] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const result = await new HmeClient(session).list();
  assert.deepEqual(result, { hmeEmails: [], selectedForwardTo: '', forwardToEmails: [] });
});

test('an empty snapshot hides aliases without deleting local marks or used state', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: { hmeEmails: [], selectedForwardTo: '', forwardToEmails: [] },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const result = await sync('account-1');
  assert.deepEqual(result.aliases, []);
  const alias = db.prepare('SELECT id, used, remote_present FROM aliases WHERE id = ?').get('alias-1') as
    { id: string; used: number; remote_present: number } | undefined;
  const hit = db.prepare('SELECT mark FROM alias_mark_hits WHERE alias_id = ?').get('alias-1') as
    { mark: string } | undefined;
  assert.deepEqual(alias, { id: 'alias-1', used: 1, remote_present: 0 });
  assert.deepEqual(hit, { mark: '已注册' });
});

test('a later snapshot restores the same alias row and its local metadata', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        success: true,
        result: {
          hmeEmails: [
            {
              origin: 'Hide My Email',
              anonymousId: 'anonymous-1',
              domain: 'icloud.com',
              forwardToEmail: 'owner@example.test',
              hme: 'keep@icloud.com',
              isActive: true,
              label: 'Restored',
              note: '',
              createTimestamp: now,
              recipientMailId: 'mail-1',
            },
          ],
          selectedForwardTo: 'owner@example.test',
          forwardToEmails: ['owner@example.test'],
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const result = await sync('account-1');
  assert.equal(result.aliases.length, 1);
  assert.equal(result.aliases[0]?.id, 'alias-1');
  assert.equal(result.aliases[0]?.used, true);
  assert.deepEqual(
    result.aliases[0]?.marks.map((hit) => hit.mark),
    ['已注册'],
  );
});

test.after(() => {
  globalThis.fetch = originalFetch;
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
