import { getDb } from '../db/index.js';
import { decryptSecret, encryptSecret } from '../crypto/secrets.js';
import {
  fetchRecentMessages,
  testConnection,
  type FetchedMessage,
  type FetchOptions,
  type ImapConnectionConfig,
} from '../imap/client.js';

export interface ImapConfigPublic {
  id: string;
  accountId: string | null;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  createdAt: number;
  updatedAt: number;
}

interface ImapConfigRow {
  id: string;
  account_id: string | null;
  label: string;
  host: string;
  port: number;
  secure: number;
  username: string;
  password_enc: string;
  auth_failed: number;
  created_at: number;
  updated_at: number;
}

function toPublic(row: ImapConfigRow): ImapConfigPublic {
  return {
    id: row.id,
    accountId: row.account_id,
    label: row.label,
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function connectionConfig(row: ImapConfigRow): ImapConnectionConfig {
  return {
    host: row.host,
    port: row.port,
    secure: row.secure === 1,
    username: row.username,
    password: decryptSecret(row.password_enc),
  };
}

export interface ImapConfigInput {
  accountId?: string | null;
  label: string;
  host: string;
  port?: number;
  secure?: boolean;
  username: string;
  password: string;
}

/** Whether an account has an IMAP mailbox configured. */
export function hasConfigForAccount(accountId: string): boolean {
  return !!getDb()
    .prepare('SELECT 1 FROM imap_configs WHERE account_id = ? LIMIT 1')
    .get(accountId);
}

/** Create or update the (single) IMAP config linked to an account. */
export function upsertForAccount(accountId: string, input: ImapConfigInput): ImapConfigPublic {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM imap_configs WHERE account_id = ? ORDER BY created_at LIMIT 1')
    .get(accountId) as { id: string } | undefined;
  if (!existing) return createConfig({ ...input, accountId });
  db.prepare(
    `UPDATE imap_configs SET label = ?, host = ?, port = ?, secure = ?, username = ?,
       password_enc = ?, auth_failed = 0, updated_at = ? WHERE id = ?`,
  ).run(
    input.label,
    input.host,
    input.port ?? 993,
    input.secure === false ? 0 : 1,
    input.username,
    encryptSecret(input.password),
    Date.now(),
    existing.id,
  );
  return toPublic(getRow(existing.id)!);
}

/** Remove all IMAP configs linked to an account. */
export function deleteConfigsForAccount(accountId: string): void {
  getDb().prepare('DELETE FROM imap_configs WHERE account_id = ?').run(accountId);
}

/** Pick only the IMAP config explicitly linked to this account. */
export function pickConfigForAccount(accountId: string): string | null {
  const linked = getDb()
    .prepare('SELECT id FROM imap_configs WHERE account_id = ? ORDER BY created_at LIMIT 1')
    .get(accountId) as { id: string } | undefined;
  return linked?.id ?? null;
}

export function listConfigs(): ImapConfigPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM imap_configs ORDER BY created_at DESC')
    .all() as ImapConfigRow[];
  return rows.map(toPublic);
}

function getRow(id: string): ImapConfigRow | undefined {
  return getDb().prepare('SELECT * FROM imap_configs WHERE id = ?').get(id) as
    | ImapConfigRow
    | undefined;
}

export function createConfig(input: ImapConfigInput): ImapConfigPublic {
  const id = crypto.randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO imap_configs (id, account_id, label, host, port, secure, username, password_enc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.accountId ?? null,
      input.label,
      input.host,
      input.port ?? 993,
      input.secure === false ? 0 : 1,
      input.username,
      encryptSecret(input.password),
      now,
      now,
    );
  return toPublic(getRow(id)!);
}

export function deleteConfig(id: string): boolean {
  return getDb().prepare('DELETE FROM imap_configs WHERE id = ?').run(id).changes > 0;
}

/** Record whether the last connection to this config authenticated OK. */
function setAuthFailed(id: string, failed: boolean): void {
  getDb()
    .prepare('UPDATE imap_configs SET auth_failed = ?, updated_at = ? WHERE id = ?')
    .run(failed ? 1 : 0, Date.now(), id);
}

/** A 401 from the client layer means the App-specific password was rejected. */
function isAuthError(err: unknown): boolean {
  return (err as { status?: number })?.status === 401;
}

/** Verify credentials by connecting to the server. */
export async function testConfig(id: string): Promise<{ ok: true }> {
  const row = getRow(id);
  if (!row) throw Object.assign(new Error('IMAP config not found'), { status: 404 });
  try {
    await testConnection(connectionConfig(row));
    setAuthFailed(id, false);
    return { ok: true };
  } catch (err) {
    if (isAuthError(err)) setAuthFailed(id, true);
    throw err;
  }
}

/** Fetch recent messages (with detected verification codes) for a config. */
export async function fetchCodes(id: string, options: FetchOptions = {}): Promise<FetchedMessage[]> {
  const row = getRow(id);
  if (!row) throw Object.assign(new Error('IMAP config not found'), { status: 404 });
  try {
    const messages = await fetchRecentMessages(connectionConfig(row), options);
    if (row.auth_failed) setAuthFailed(id, false); // recovered
    return messages;
  } catch (err) {
    if (isAuthError(err)) setAuthFailed(id, true);
    throw err;
  }
}

/** Ad-hoc fetch without persisting a config (one-off lookups). */
export async function fetchCodesAdhoc(
  connection: ImapConnectionConfig,
  options: FetchOptions = {},
): Promise<FetchedMessage[]> {
  return fetchRecentMessages(connection, options);
}
