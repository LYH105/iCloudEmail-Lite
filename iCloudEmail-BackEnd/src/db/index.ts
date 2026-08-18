import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config.js';

export type DB = Database.Database;

let instance: DB | null = null;

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS accounts (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  apple_id           TEXT,
  dsid               TEXT,
  webservice_url     TEXT,
  client_id          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'awaiting_code',
  cookie_enc         TEXT,
  session_cookies_enc TEXT,
  login_password_enc TEXT,
  trust_token_enc    TEXT,
  china              INTEGER NOT NULL DEFAULT 1,
  auto_create_enabled INTEGER NOT NULL DEFAULT 0,
  auto_create_failures INTEGER NOT NULL DEFAULT 0,
  auto_create_next_attempt_at INTEGER,
  disabled           INTEGER NOT NULL DEFAULT 0,
  profile_dir        TEXT,
  last_error         TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS aliases (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  anonymous_id      TEXT NOT NULL,
  hme               TEXT NOT NULL,
  domain            TEXT,
  forward_to_email  TEXT,
  label             TEXT,
  note              TEXT,
  origin            TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  recipient_mail_id TEXT,
  create_timestamp  INTEGER,
  synced_at         INTEGER NOT NULL,
  mark              TEXT,
  marked_at         INTEGER,
  mark_source       TEXT,
  used              INTEGER NOT NULL DEFAULT 0,
  used_at           INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aliases_account_anon ON aliases (account_id, anonymous_id);
CREATE INDEX IF NOT EXISTS idx_aliases_hme ON aliases (hme);

-- Marks accumulate per alias (one row per achieved mark) instead of a single
-- "latest wins" column, so a row can be recognized as matching multiple rules
-- at once (e.g. both "已注册" and "已开通").
CREATE TABLE IF NOT EXISTS alias_mark_hits (
  alias_id TEXT NOT NULL REFERENCES aliases(id) ON DELETE CASCADE,
  mark     TEXT NOT NULL,
  hit_at   INTEGER NOT NULL,
  source   TEXT,
  PRIMARY KEY (alias_id, mark)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL,
  scopes       TEXT NOT NULL DEFAULT 'read,write',
  revoked      INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);

CREATE TABLE IF NOT EXISTS mark_rules (
  id               TEXT PRIMARY KEY,
  mark             TEXT NOT NULL,
  from_contains    TEXT,
  subject_contains TEXT,
  body_contains    TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_create_logs (
  id            TEXT PRIMARY KEY,
  account_id    TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  success       INTEGER NOT NULL,
  created_count INTEGER NOT NULL DEFAULT 0,
  error_count   INTEGER NOT NULL DEFAULT 0,
  message       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auto_create_logs_created_at ON auto_create_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS imap_configs (
  id           TEXT PRIMARY KEY,
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  label        TEXT NOT NULL,
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL DEFAULT 993,
  secure       INTEGER NOT NULL DEFAULT 1,
  username     TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  auth_failed  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
`;

/** Lightweight migration: add a column to an existing table if it's missing. */
function ensureColumn(db: DB, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/**
 * Lightweight migration: drop a retired column from an existing table.
 * Only safe for plain, unindexed columns (SQLite refuses the rest anyway).
 */
function dropColumn(db: DB, table: string, column: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

export function getDb(): DB {
  if (instance) return instance;
  mkdirSync(dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');

  let version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    const migrateV1 = db.transaction(() => {
      db.exec(SCHEMA);
      // Migrations for databases created before these columns existed.
      ensureColumn(db, 'accounts', 'login_password_enc', 'login_password_enc TEXT');
      ensureColumn(db, 'accounts', 'session_cookies_enc', 'session_cookies_enc TEXT');
      ensureColumn(db, 'accounts', 'trust_token_enc', 'trust_token_enc TEXT');
      ensureColumn(db, 'accounts', 'china', 'china INTEGER NOT NULL DEFAULT 1');
      ensureColumn(
        db,
        'accounts',
        'auto_create_enabled',
        'auto_create_enabled INTEGER NOT NULL DEFAULT 0',
      );
      ensureColumn(
        db,
        'accounts',
        'auto_create_failures',
        'auto_create_failures INTEGER NOT NULL DEFAULT 0',
      );
      ensureColumn(
        db,
        'accounts',
        'auto_create_next_attempt_at',
        'auto_create_next_attempt_at INTEGER',
      );
      ensureColumn(db, 'accounts', 'disabled', 'disabled INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db, 'aliases', 'mark', 'mark TEXT');
      ensureColumn(db, 'aliases', 'marked_at', 'marked_at INTEGER');
      ensureColumn(db, 'aliases', 'mark_source', 'mark_source TEXT');
      ensureColumn(db, 'aliases', 'used', 'used INTEGER NOT NULL DEFAULT 0');
      ensureColumn(db, 'aliases', 'used_at', 'used_at INTEGER');
      ensureColumn(db, 'imap_configs', 'auth_failed', 'auth_failed INTEGER NOT NULL DEFAULT 0');
      // The browser inbox portal is gone, and with it the per-alias login password
      // it stored here. Drop the column so old and new databases share one schema.
      dropColumn(db, 'aliases', 'mail_password_enc');
      // Backfill: older builds stored 0 when Apple's reserve response had no
      // createTimestamp, which rendered as 1970-01-01. A later sync fills real
      // values from Apple's list endpoint.
      db.exec('UPDATE aliases SET create_timestamp = NULL WHERE create_timestamp = 0');
      // One-time backfill: carry the old single "latest mark" column over into
      // alias_mark_hits so upgrading doesn't lose marks already on record.
      db.exec(
        `INSERT OR IGNORE INTO alias_mark_hits (alias_id, mark, hit_at, source)
         SELECT id, mark, COALESCE(marked_at, synced_at), mark_source FROM aliases WHERE mark IS NOT NULL`,
      );
      // One-time migration: auto-create used to be a single global on/off switch.
      const legacyAutoCreate = db
        .prepare("SELECT value FROM app_settings WHERE key = 'auto_create'")
        .get() as { value: string } | undefined;
      if (legacyAutoCreate) {
        try {
          const parsed = JSON.parse(legacyAutoCreate.value) as { enabled?: boolean };
          if (parsed.enabled) {
            db.exec("UPDATE accounts SET auto_create_enabled = 1 WHERE status = 'active'");
          }
        } catch {
          /* malformed legacy setting — nothing to carry over */
        }
        db.exec("DELETE FROM app_settings WHERE key = 'auto_create'");
      }
      // One-time migration: the account "label" concept is retired.
      const labelsCleared = db
        .prepare("SELECT 1 FROM app_settings WHERE key = 'account_labels_cleared'")
        .get();
      if (!labelsCleared) {
        db.exec('UPDATE accounts SET label = id WHERE label != id');
        db.prepare(
          "INSERT INTO app_settings (key, value, updated_at) VALUES ('account_labels_cleared', '1', ?)",
        ).run(Date.now());
      }
      db.pragma('user_version = 1');
    });
    migrateV1();
    version = 1;
  }

  if (version < 2) {
    const migrateV2 = db.transaction(() => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_aliases_account_created
          ON aliases (account_id, create_timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_alias_mark_hits_mark
          ON alias_mark_hits (mark);
        CREATE INDEX IF NOT EXISTS idx_imap_configs_account_created
          ON imap_configs (account_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_auto_create_logs_account_created
          ON auto_create_logs (account_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_accounts_background_jobs
          ON accounts (disabled, status, auto_create_enabled);
      `);
      db.pragma('user_version = 2');
    });
    migrateV2();
  }
  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
