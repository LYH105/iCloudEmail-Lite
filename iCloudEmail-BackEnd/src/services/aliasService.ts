import { getDb } from '../db/index.js';
import type { HmeEmail } from '../icloud/types.js';
import type { FetchedMessage } from '../imap/client.js';
import { logger } from '../logger.js';
import { withHmeClient } from './accountService.js';
import { fetchCodes, pickConfigForAccount } from './imapService.js';
import {
  applyRulesToAlias,
  getAllHits,
  getHitsForAccount,
  getHitsForAlias,
  type AliasMarkHit,
} from './markService.js';

export interface AliasPublic {
  id: string;
  accountId: string;
  anonymousId: string;
  hme: string;
  domain: string | null;
  forwardToEmail: string | null;
  label: string | null;
  note: string | null;
  origin: string | null;
  isActive: boolean;
  recipientMailId: string | null;
  createTimestamp: number | null;
  syncedAt: number;
  marks: AliasMarkHit[];
  used: boolean;
  usedAt: number | null;
}

interface AliasRow {
  id: string;
  account_id: string;
  anonymous_id: string;
  hme: string;
  domain: string | null;
  forward_to_email: string | null;
  label: string | null;
  note: string | null;
  origin: string | null;
  is_active: number;
  recipient_mail_id: string | null;
  create_timestamp: number | null;
  synced_at: number;
  used: number;
  used_at: number | null;
}

function toPublic(row: AliasRow, marks: AliasMarkHit[]): AliasPublic {
  return {
    id: row.id,
    accountId: row.account_id,
    anonymousId: row.anonymous_id,
    hme: row.hme,
    domain: row.domain,
    forwardToEmail: row.forward_to_email,
    label: row.label,
    note: row.note,
    origin: row.origin,
    isActive: row.is_active === 1,
    recipientMailId: row.recipient_mail_id,
    createTimestamp: row.create_timestamp,
    syncedAt: row.synced_at,
    marks,
    used: row.used === 1,
    usedAt: row.used_at,
  };
}

/** Insert or update the local mirror of an HmeEmail for an account. */
function upsert(accountId: string, email: HmeEmail): AliasPublic {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare('SELECT id FROM aliases WHERE account_id = ? AND anonymous_id = ?')
    .get(accountId, email.anonymousId) as { id: string } | undefined;
  const id = existing?.id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO aliases (id, account_id, anonymous_id, hme, domain, forward_to_email, label, note,
                          origin, is_active, recipient_mail_id, create_timestamp, synced_at)
     VALUES (@id, @account_id, @anonymous_id, @hme, @domain, @forward_to_email, @label, @note,
             @origin, @is_active, @recipient_mail_id, @create_timestamp, @synced_at)
     ON CONFLICT(account_id, anonymous_id) DO UPDATE SET
       hme=excluded.hme, domain=excluded.domain, forward_to_email=excluded.forward_to_email,
       label=excluded.label, note=excluded.note, origin=excluded.origin,
       is_active=excluded.is_active, recipient_mail_id=excluded.recipient_mail_id,
       create_timestamp=excluded.create_timestamp, synced_at=excluded.synced_at`,
  ).run({
    id,
    account_id: accountId,
    anonymous_id: email.anonymousId,
    hme: email.hme,
    domain: email.domain ?? null,
    forward_to_email: email.forwardToEmail ?? null,
    label: email.label ?? null,
    note: email.note ?? null,
    origin: email.origin ?? null,
    is_active: email.isActive ? 1 : 0,
    recipient_mail_id: email.recipientMailId ?? null,
    // Apple sends 0 when it has no timestamp (fresh reserve) — store NULL.
    create_timestamp: email.createTimestamp || null,
    synced_at: now,
  });
  const row = db.prepare('SELECT * FROM aliases WHERE id = ?').get(id) as AliasRow;
  return toPublic(row, getHitsForAlias(id));
}

/** Local cached aliases (does not hit Apple). */
export function listLocal(accountId: string): AliasPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM aliases WHERE account_id = ? ORDER BY create_timestamp DESC')
    .all(accountId) as AliasRow[];
  const hits = getHitsForAccount(accountId);
  return rows.map((r) => toPublic(r, hits.get(r.id) ?? []));
}

/** Local cached aliases across every account (does not hit Apple). */
export function listAllLocal(): AliasPublic[] {
  const rows = getDb()
    .prepare('SELECT * FROM aliases ORDER BY create_timestamp DESC')
    .all() as AliasRow[];
  const hits = getAllHits();
  return rows.map((r) => toPublic(r, hits.get(r.id) ?? []));
}

export interface SyncResult {
  aliases: AliasPublic[];
  selectedForwardTo: string;
  forwardToEmails: string[];
}

/** Pull the live list from Apple and refresh the local mirror. */
export async function sync(accountId: string): Promise<SyncResult> {
  return withHmeClient(accountId, async (hme) => {
    const result = await hme.list();
    const db = getDb();
    const applySync = db.transaction((emails: HmeEmail[]) => {
      const kept = new Set<string>();
      for (const email of emails) {
        upsert(accountId, email);
        kept.add(email.anonymousId);
      }
      // Drop locally-cached aliases that no longer exist upstream.
      const local = db
        .prepare('SELECT anonymous_id FROM aliases WHERE account_id = ?')
        .all(accountId) as { anonymous_id: string }[];
      for (const { anonymous_id } of local) {
        if (!kept.has(anonymous_id)) {
          db.prepare('DELETE FROM aliases WHERE account_id = ? AND anonymous_id = ?').run(
            accountId,
            anonymous_id,
          );
        }
      }
    });
    applySync(result.hmeEmails);
    return {
      aliases: listLocal(accountId),
      selectedForwardTo: result.selectedForwardTo,
      forwardToEmails: result.forwardToEmails,
    };
  });
}

export interface SyncAllResult {
  synced: number;
  errors: { account: string; message: string }[];
}

/** Sync every active account's alias list from Apple, aggregating outcomes. */
export async function syncAllAccounts(): Promise<SyncAllResult> {
  const rows = getDb()
    .prepare("SELECT id, label FROM accounts WHERE status = 'active' AND disabled = 0")
    .all() as {
    id: string;
    label: string;
  }[];
  let synced = 0;
  const errors: { account: string; message: string }[] = [];
  for (const row of rows) {
    try {
      await sync(row.id);
      synced++;
    } catch (err) {
      errors.push({ account: row.label, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { synced, errors };
}

/** Generate a fresh, unreserved address (not yet persisted). */
export async function generate(accountId: string): Promise<{ hme: string }> {
  return withHmeClient(accountId, async (hme) => ({ hme: await hme.generate() }));
}

/**
 * Set the account-wide forwarding destination (applies to ALL Hide My Email
 * aliases at once) and refresh the local cache. `forwardToEmail` must be one of
 * the account's registered forwarding addresses (see SyncResult.forwardToEmails).
 */
export async function setForwardTo(
  accountId: string,
  forwardToEmail: string,
): Promise<SyncResult> {
  return withHmeClient(accountId, async (client) => {
    await client.updateForwardTo(forwardToEmail);
    const result = await client.list();
    const db = getDb();
    const tx = db.transaction((emails: HmeEmail[]) => {
      for (const email of emails) upsert(accountId, email);
    });
    tx(result.hmeEmails);
    return {
      aliases: listLocal(accountId),
      selectedForwardTo: result.selectedForwardTo,
      forwardToEmails: result.forwardToEmails,
    };
  });
}

/** Apple's reserve response lacks createTimestamp — stamp fresh aliases now. */
function stampNew(email: HmeEmail): HmeEmail {
  return { ...email, createTimestamp: email.createTimestamp || Date.now() };
}

/** Reserve a previously generated address. */
export async function reserve(
  accountId: string,
  hme: string,
  label: string,
  note = '',
): Promise<AliasPublic> {
  return withHmeClient(accountId, async (client) => {
    const email = await client.reserve(hme, label, note);
    return upsert(accountId, stampNew(email));
  });
}

/** Generate + reserve in a single call. */
export async function create(accountId: string, label: string, note = ''): Promise<AliasPublic> {
  return withHmeClient(accountId, async (client) => {
    const email = await client.createAndReserve(label, note);
    return upsert(accountId, stampNew(email));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timestampLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface BatchResult {
  created: AliasPublic[];
  errors: { index: number; message: string }[];
}

/**
 * Generate + reserve `count` aliases in one go. Each alias is created through
 * its own {@link withHmeClient} call, so an expired cookie is silently
 * refreshed from the persistent profile mid-batch without re-creating earlier
 * successes. A short delay between calls keeps Apple's rate limiting happy.
 */
export async function createBatch(
  accountId: string,
  count: number,
  label?: string,
  note = '',
): Promise<BatchResult> {
  const total = Math.max(1, Math.min(count, 25));
  const base = label?.trim() || timestampLabel();
  const created: AliasPublic[] = [];
  const errors: { index: number; message: string }[] = [];

  for (let i = 0; i < total; i++) {
    const itemLabel = total > 1 ? `${base} #${i + 1}` : base;
    try {
      const email = await withHmeClient(accountId, (client) =>
        client.createAndReserve(itemLabel, note),
      );
      created.push(upsert(accountId, stampNew(email)));
    } catch (err) {
      errors.push({ index: i, message: err instanceof Error ? err.message : String(err) });
    }
    if (i < total - 1) await sleep(800);
  }
  return { created, errors };
}

function setActive(accountId: string, anonymousId: string, active: boolean): void {
  getDb()
    .prepare(
      'UPDATE aliases SET is_active = ?, synced_at = ? WHERE account_id = ? AND anonymous_id = ?',
    )
    .run(active ? 1 : 0, Date.now(), accountId, anonymousId);
}

export async function deactivate(accountId: string, anonymousId: string): Promise<AliasPublic> {
  return withHmeClient(accountId, async (client) => {
    await client.deactivate(anonymousId);
    setActive(accountId, anonymousId, false);
    return getLocal(accountId, anonymousId);
  });
}

export async function reactivate(accountId: string, anonymousId: string): Promise<AliasPublic> {
  return withHmeClient(accountId, async (client) => {
    await client.reactivate(anonymousId);
    setActive(accountId, anonymousId, true);
    return getLocal(accountId, anonymousId);
  });
}

export async function remove(accountId: string, anonymousId: string): Promise<{ deleted: true }> {
  return withHmeClient(accountId, async (client) => {
    await client.delete(anonymousId);
    getDb()
      .prepare('DELETE FROM aliases WHERE account_id = ? AND anonymous_id = ?')
      .run(accountId, anonymousId);
    return { deleted: true } as const;
  });
}

/** Manually mark an alias as used/unused — local-only, no Apple call. */
export function setUsed(accountId: string, anonymousId: string, used: boolean): AliasPublic {
  const db = getDb();
  const row = db
    .prepare('SELECT id FROM aliases WHERE account_id = ? AND anonymous_id = ?')
    .get(accountId, anonymousId) as { id: string } | undefined;
  if (!row) throw Object.assign(new Error('别名不存在'), { status: 404 });
  db.prepare('UPDATE aliases SET used = ?, used_at = ?, synced_at = ? WHERE id = ?').run(
    used ? 1 : 0,
    used ? Date.now() : null,
    Date.now(),
    row.id,
  );
  return getLocal(accountId, anonymousId);
}

function getLocal(accountId: string, anonymousId: string): AliasPublic {
  const row = getDb()
    .prepare('SELECT * FROM aliases WHERE account_id = ? AND anonymous_id = ?')
    .get(accountId, anonymousId) as AliasRow | undefined;
  if (!row) throw new Error('Alias not found locally after operation');
  return toPublic(row, getHitsForAlias(row.id));
}

/**
 * Fetch recent inbox messages addressed to a specific alias, via an IMAP config
 * (the one linked to the account, or the first configured). Returns the parsed
 * messages with detected verification codes.
 */
export async function fetchMail(
  accountId: string,
  anonymousId: string,
  options: { sinceMinutes?: number; limit?: number } = {},
): Promise<{ alias: string; messages: FetchedMessage[] }> {
  const row = getDb()
    .prepare('SELECT id, hme FROM aliases WHERE account_id = ? AND anonymous_id = ?')
    .get(accountId, anonymousId) as { id: string; hme: string } | undefined;
  if (!row) throw Object.assign(new Error('别名不存在'), { status: 404 });

  const configId = pickConfigForAccount(accountId);
  if (!configId) {
    throw Object.assign(
      new Error('该账户尚未设置收件邮箱：请到「账户」页点该账户的「设置邮箱」填入 App 专用密码'),
      { status: 409 },
    );
  }
  const messages = await fetchCodes(configId, {
    sinceMinutes: options.sinceMinutes ?? 1440,
    limit: options.limit ?? 15,
    filterTo: row.hme,
  });
  // Mail just fetched here (e.g. a "收件" click) already tells us everything a
  // periodic scan would learn about this one alias — apply rules immediately
  // instead of waiting up to MARK_SCAN_MINUTES for the next background pass.
  applyRulesToAlias(row.id, messages);
  return { alias: row.hme, messages };
}

/* ---- aggregate mail across all aliases (总邮件库) ---- */

export interface LibraryMessage extends FetchedMessage {
  alias: string;
  accountId: string;
}

/**
 * One combined inbox across every IMAP-connected account: fetch each account's
 * INBOX once (prefiltered to that account's alias addresses), then map every
 * message to the alias(es) it was addressed to. Newest first.
 */
export async function listMailLibrary(sinceMinutes = 1440): Promise<LibraryMessage[]> {
  const db = getDb();
  const accountIds = (
    db
      .prepare(
        'SELECT id FROM accounts WHERE disabled = 0 AND EXISTS (SELECT 1 FROM imap_configs WHERE account_id = accounts.id)',
      )
      .all() as { id: string }[]
  ).map((r) => r.id);

  const out: LibraryMessage[] = [];
  for (const accountId of accountIds) {
    const aliasRows = db
      .prepare('SELECT hme FROM aliases WHERE account_id = ?')
      .all(accountId) as { hme: string }[];
    if (aliasRows.length === 0) continue;
    const configId = pickConfigForAccount(accountId);
    if (!configId) continue;
    try {
      const messages = await fetchCodes(configId, {
        sinceMinutes,
        limit: 100,
        withHeaders: true,
        prefilterRecipients: aliasRows.map((a) => a.hme),
      });
      for (const msg of messages) {
        const haystack = `${msg.to}\n${msg.headers ?? ''}`.toLowerCase();
        for (const a of aliasRows) {
          if (haystack.includes(a.hme.toLowerCase())) {
            out.push({ ...msg, alias: a.hme, accountId });
          }
        }
      }
    } catch (err) {
      logger.warn(
        `[mail-library] account ${accountId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
