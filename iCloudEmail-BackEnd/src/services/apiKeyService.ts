import { getDb } from '../db/index.js';
import { randomToken, safeEqualHex, sha256Hex } from '../crypto/secrets.js';

export type Scope = 'read' | 'write';

export interface ApiKeyPublic {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  revoked: boolean;
  lastUsedAt: number | null;
  createdAt: number;
}

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string;
  revoked: number;
  last_used_at: number | null;
  created_at: number;
}

const KEY_PREFIX = 'ihme_';

function toPublic(row: ApiKeyRow): ApiKeyPublic {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes.split(',').filter(Boolean) as Scope[],
    revoked: row.revoked === 1,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export interface CreatedApiKey extends ApiKeyPublic {
  /** Full plaintext key — shown exactly once, never stored. */
  key: string;
}

export function createApiKey(name: string, scopes: Scope[] = ['read', 'write']): CreatedApiKey {
  const secret = randomToken(24);
  const key = `${KEY_PREFIX}${secret}`;
  const id = crypto.randomUUID();
  const now = Date.now();
  const keyPrefix = key.slice(0, 12);
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, name, key_prefix, key_hash, scopes, revoked, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(id, name, keyPrefix, sha256Hex(key), scopes.join(','), now);
  return {
    id,
    name,
    key,
    keyPrefix,
    scopes,
    revoked: false,
    lastUsedAt: null,
    createdAt: now,
  };
}

export function listApiKeys(): ApiKeyPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    .all() as ApiKeyRow[];
  return rows.map(toPublic);
}

export function revokeApiKey(id: string): boolean {
  const info = getDb().prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(id);
  return info.changes > 0;
}

export function deleteApiKey(id: string): boolean {
  const info = getDb().prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  return info.changes > 0;
}

export interface VerifiedKey {
  id: string;
  scopes: Scope[];
}

/** Validate a presented key. Returns the key's scopes, or null if invalid/revoked. */
export function verifyApiKey(rawKey: string): VerifiedKey | null {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const hash = sha256Hex(rawKey);
  const row = getDb()
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(hash) as ApiKeyRow | undefined;
  if (!row) return null;
  // Constant-time confirmation on the stored hash.
  if (!safeEqualHex(hash, row.key_hash)) return null;
  getDb().prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { id: row.id, scopes: row.scopes.split(',').filter(Boolean) as Scope[] };
}

/** True when no keys exist yet — used to bootstrap the first key without auth. */
export function hasAnyApiKey(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM api_keys').get() as { n: number };
  return row.n > 0;
}
