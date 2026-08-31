import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'ihme-db-test-'));
process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'unit-test-master-key-0123456789';
process.env.DATABASE_PATH = join(dir, 'test.sqlite');

const { closeDb, getDb } = await import('../src/db/index.js');
const { createConfig, pickConfigForAccount } = await import('../src/services/imapService.js');

test('fresh database migrates to schema v4 with safe defaults and indexes', () => {
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), 4);

  const columns = db.prepare('PRAGMA table_info(accounts)').all() as {
    name: string;
    dflt_value: string | null;
  }[];
  assert.equal(columns.find((column) => column.name === 'auto_create_enabled')?.dflt_value, '0');
  assert.ok(columns.some((column) => column.name === 'auto_create_failures'));
  assert.ok(columns.some((column) => column.name === 'auto_create_next_attempt_at'));

  const aliasColumns = db.prepare('PRAGMA table_info(aliases)').all() as {
    name: string;
    dflt_value: string | null;
  }[];
  assert.equal(aliasColumns.find((column) => column.name === 'remote_present')?.dflt_value, '1');

  const indexes = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map(
      (row) => row.name,
    ),
  );
  for (const name of [
    'idx_aliases_account_created',
    'idx_alias_mark_hits_mark',
    'idx_imap_configs_account_created',
    'idx_auto_create_logs_account_created',
    'idx_accounts_background_jobs',
    'idx_aliases_account_present_created',
  ]) {
    assert.ok(indexes.has(name), `missing index ${name}`);
  }
});

test('IMAP lookup never falls back to another account mailbox', () => {
  const db = getDb();
  const now = Date.now();
  const insertAccount = db.prepare(
    `INSERT INTO accounts (id, label, client_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  );
  insertAccount.run('account-a', 'Account A', 'client-a', now, now);
  insertAccount.run('account-b', 'Account B', 'client-b', now, now);

  const config = createConfig({
    accountId: 'account-b',
    label: 'Account B',
    host: 'imap.example.test',
    username: 'b@example.test',
    password: 'app-password',
  });

  assert.equal(pickConfigForAccount('account-a'), null);
  assert.equal(pickConfigForAccount('account-b'), config.id);
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
