import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const dir = mkdtempSync(join(tmpdir(), 'ihme-db-upgrade-'));
const databasePath = join(dir, 'legacy.sqlite');
const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    auto_create_enabled INTEGER NOT NULL DEFAULT 1,
    auto_create_failures INTEGER NOT NULL DEFAULT 4,
    auto_create_next_attempt_at INTEGER
  );
  INSERT INTO accounts VALUES ('legacy-account', 1, 4, 9999999999999);
  PRAGMA user_version = 2;
`);
legacy.close();

process.env.NODE_ENV = 'test';
process.env.SECRET_MASTER_KEY = 'db-upgrade-master-key-0123456789';
process.env.DATABASE_PATH = databasePath;

const { closeDb, getDb } = await import('../src/db/index.js');

test('v3/v4 migrations disable legacy auto-create and add safe alias snapshots', () => {
  const db = getDb();
  assert.equal(db.pragma('user_version', { simple: true }), 4);
  const row = db
    .prepare(
      'SELECT auto_create_enabled, auto_create_failures, auto_create_next_attempt_at FROM accounts WHERE id = ?',
    )
    .get('legacy-account') as {
    auto_create_enabled: number;
    auto_create_failures: number;
    auto_create_next_attempt_at: number | null;
  };
  assert.deepEqual(row, {
    auto_create_enabled: 0,
    auto_create_failures: 0,
    auto_create_next_attempt_at: null,
  });
  const aliasColumns = db.prepare('PRAGMA table_info(aliases)').all() as { name: string }[];
  assert.ok(aliasColumns.some((column) => column.name === 'remote_present'));
});

test.after(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});
