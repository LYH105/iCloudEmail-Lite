import { ImapFlow } from 'imapflow';
import PostalMime from 'postal-mime';
import { createHash } from 'node:crypto';
import { extractCodes, type CodeCandidate } from './codeExtractor.js';
import { extractLinks, type LinkCandidate } from './linkExtractor.js';

export interface ImapConnectionConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
}

export interface FetchOptions {
  mailbox?: string; // defaults to INBOX
  sinceMinutes?: number; // only messages newer than this (default 60)
  limit?: number; // max messages to return (newest first, default 20)
  filterTo?: string; // only messages addressed to this alias (To/Delivered-To)
  withHeaders?: boolean; // include the raw header block on each message
  // Header-first prefilter: bodies are only downloaded for messages whose
  // headers mention one of these addresses (aliases). Same effect as
  // filterTo but for many addresses at once.
  prefilterRecipients?: string[];
}

export interface FetchedMessage {
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string; // ISO
  text: string;
  html: string | null; // original rendered HTML body, if any
  codes: CodeCandidate[];
  links: LinkCandidate[]; // likely sign-in / verification links
  headers?: string; // raw header block (when FetchOptions.withHeaders)
}

/**
 * Raw header block of a message. HME-forwarded mail keeps the alias as the
 * original recipient somewhere in there (Delivered-To / X-Forwarded-To / …),
 * so this is what alias matching scans.
 */
function headerBlock(source: Buffer): string {
  return (
    source
      .subarray(0, 12000)
      .toString('utf8')
      .split(/\r?\n\r?\n/, 1)[0] ?? ''
  );
}

function addressText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(addressText).filter(Boolean).join(', ');
  if (typeof value !== 'object') return '';
  const v = value as { name?: string; address?: string; group?: unknown[]; text?: string };
  if (v.text) return v.text;
  if (v.group) return addressText(v.group);
  if (!v.address) return '';
  return v.name ? `${v.name} <${v.address}>` : v.address;
}

function isoDate(value: string | Date | undefined): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * Turn imapflow's terse errors into something actionable. Its auth failure
 * surfaces only as `Command failed`; here it becomes a clear, fixable message.
 */
function friendlyImapError(err: unknown): Error {
  const e = err as { authenticationFailed?: boolean; responseText?: string };
  if (e?.authenticationFailed || /authentication\s*failed/i.test(e?.responseText ?? '')) {
    return Object.assign(
      new Error(
        '邮箱登录失败：App 专用密码无效或已被撤销，请到「账户」页编辑该账户，重新生成并填写 App 专用密码',
      ),
      { status: 401 },
    );
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/\b(?:ETIMEDOUT|timeout|timed out)\b/i.test(message)) {
    return Object.assign(new Error('邮箱服务器响应超时，请检查网络或稍后重试'), {
      status: 504,
    });
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Verify credentials by connecting and logging out. Throws on failure. */
export async function testConnection(cfg: ImapConnectionConfig): Promise<void> {
  const client = buildClient(cfg);
  try {
    await client.connect();
    await client.logout();
  } catch (err) {
    try {
      client.close();
    } catch {
      /* already gone */
    }
    throw friendlyImapError(err);
  }
}

function buildClient(cfg: ImapConnectionConfig): ImapFlow {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.username, pass: cfg.password },
    logger: false,
    // Bound every network phase so one unreachable provider cannot stall a
    // foreground refresh or background scan indefinitely.
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
}

/* ---- connection pool ----------------------------------------------------
 * iCloud's IMAP handshake (TLS + LOGIN + SELECT) costs several seconds; keep
 * authenticated connections warm for a few minutes so repeated fetches
 * (收件 clicks, background scans) skip it entirely.
 */
const pool = new Map<string, ImapFlow>();
const idleTimers = new Map<string, NodeJS.Timeout>();
const IDLE_LOGOUT_MS = 3 * 60_000;
/** Verification mail should be small; never materialize attachment-heavy mail. */
export const MAX_MESSAGE_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_FETCH_SOURCE_BYTES = 24 * 1024 * 1024;
const HEADER_PREFILTER_BYTES = 16 * 1024;

/** Pick newest messages while enforcing both a count and aggregate byte cap. */
export function selectUidsWithinBudget(
  candidates: number[],
  sizes: ReadonlyMap<number, number>,
  limit: number,
  budget = MAX_FETCH_SOURCE_BYTES,
): number[] {
  const selected: number[] = [];
  let used = 0;
  for (let index = candidates.length - 1; index >= 0 && selected.length < limit; index--) {
    const uid = candidates[index];
    if (uid === undefined) continue;
    const size = sizes.get(uid);
    if (size === undefined || size < 0 || size > MAX_MESSAGE_SOURCE_BYTES) continue;
    if (used + size > budget) continue;
    selected.push(uid);
    used += size;
  }
  return selected.reverse();
}

/** @internal Stable pool identity; includes a one-way credential fingerprint. */
export function connectionPoolKey(cfg: ImapConnectionConfig): string {
  const credential = createHash('sha256').update(cfg.password).digest('base64url');
  return `${cfg.host}:${cfg.port}:${cfg.secure ? 1 : 0}:${cfg.username}:${credential}`;
}

function discard(key: string): void {
  const client = pool.get(key);
  pool.delete(key);
  const timer = idleTimers.get(key);
  if (timer) clearTimeout(timer);
  idleTimers.delete(key);
  if (client) {
    client.logout().catch(() => {
      try {
        client.close();
      } catch {
        /* already gone */
      }
    });
  }
}

/** Close a pooled session before its stored connection settings are changed. */
export function invalidateConnection(cfg: ImapConnectionConfig): void {
  discard(connectionPoolKey(cfg));
}

async function getClient(cfg: ImapConnectionConfig): Promise<ImapFlow> {
  const key = connectionPoolKey(cfg);
  const timer = idleTimers.get(key);
  if (timer) clearTimeout(timer);
  const existing = pool.get(key);
  if (existing?.usable) return existing;
  pool.delete(key);
  const client = buildClient(cfg);
  // Without an error listener a dropped socket would crash the process.
  client.on('error', () => discard(key));
  client.on('close', () => {
    if (pool.get(key) === client) pool.delete(key);
  });
  await client.connect();
  pool.set(key, client);
  return client;
}

function scheduleIdleLogout(cfg: ImapConnectionConfig): void {
  const key = connectionPoolKey(cfg);
  const prev = idleTimers.get(key);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => discard(key), IDLE_LOGOUT_MS);
  timer.unref();
  idleTimers.set(key, timer);
}

/**
 * Fetch recent messages from a mailbox, parse their bodies, and attach any
 * detected verification codes. Newest messages first.
 *
 * With filterTo / prefilterRecipients, fetching is two-phase: headers only
 * (cheap, a few KB each) over a wide window to find messages addressed to
 * our aliases, then full bodies for just those — unrelated mail is never
 * downloaded.
 */
export async function fetchRecentMessages(
  cfg: ImapConnectionConfig,
  options: FetchOptions = {},
): Promise<FetchedMessage[]> {
  try {
    try {
      return await fetchOnce(await getClient(cfg), options);
    } catch {
      // The pooled connection may have gone stale — retry once on a fresh one.
      discard(connectionPoolKey(cfg));
      return await fetchOnce(await getClient(cfg), options);
    }
  } catch (err) {
    throw friendlyImapError(err);
  } finally {
    scheduleIdleLogout(cfg);
  }
}

async function fetchOnce(client: ImapFlow, options: FetchOptions): Promise<FetchedMessage[]> {
  const mailbox = options.mailbox ?? 'INBOX';
  const sinceMinutes = options.sinceMinutes ?? 60;
  const limit = options.limit ?? 20;
  const since = new Date(Date.now() - sinceMinutes * 60_000);
  const prefilter = [
    ...(options.prefilterRecipients ?? []),
    ...(options.filterTo ? [options.filterTo] : []),
  ].map((s) => s.toLowerCase());

  const results: FetchedMessage[] = [];
  const lock = await client.getMailboxLock(mailbox);
  try {
    const uids = await client.search({ since }, { uid: true });
    if (!uids || uids.length === 0) return [];

    let selected: number[];
    const headerByUid = new Map<number, string>();
    if (prefilter.length > 0) {
      // Phase 1: a bounded header prefix plus RFC822.SIZE over a wide window.
      // This prevents a maliciously huge header block from being materialized.
      const window = uids.slice(-300);
      const matched = new Set<number>();
      const sizeByUid = new Map<number, number>();
      for await (const msg of client.fetch(
        window,
        { uid: true, size: true, source: { maxLength: HEADER_PREFILTER_BYTES } },
        { uid: true },
      )) {
        if (typeof msg.size !== 'number' || msg.size > MAX_MESSAGE_SOURCE_BYTES) continue;
        sizeByUid.set(msg.uid, msg.size);
        const header = msg.source ? headerBlock(msg.source) : '';
        if (!header) continue;
        const lower = header.toLowerCase();
        if (prefilter.some((p) => lower.includes(p))) {
          matched.add(msg.uid);
          headerByUid.set(msg.uid, header);
        }
      }
      selected = selectUidsWithinBudget(
        window.filter((uid) => matched.has(uid)),
        sizeByUid,
        limit,
      );
    } else {
      // Look slightly farther back so a few attachment-heavy messages do not
      // hide all otherwise valid recent verification mail.
      const candidates = uids.slice(-Math.max(limit * 3, limit));
      const sizeByUid = new Map<number, number>();
      for await (const msg of client.fetch(candidates, { uid: true, size: true }, { uid: true })) {
        if (typeof msg.size === 'number') sizeByUid.set(msg.uid, msg.size);
      }
      selected = selectUidsWithinBudget(candidates, sizeByUid, limit);
    }
    if (selected.length === 0) return [];

    // Phase 2: full source only for the messages we actually want.
    for await (const message of client.fetch(
      selected,
      {
        uid: true,
        envelope: true,
        size: true,
        source: { maxLength: MAX_MESSAGE_SOURCE_BYTES + 1 },
      },
      { uid: true },
    )) {
      if (!message.source) continue;
      if (
        message.source.length > MAX_MESSAGE_SOURCE_BYTES ||
        (typeof message.size === 'number' && message.size > MAX_MESSAGE_SOURCE_BYTES)
      ) {
        continue;
      }
      const parsed = await PostalMime.parse(message.source);
      const to = addressText(parsed.to) || addressText(message.envelope?.to);
      const subject = parsed.subject ?? message.envelope?.subject ?? '';
      const html = typeof parsed.html === 'string' ? parsed.html : null;
      const text = parsed.text ?? '';
      results.push({
        uid: message.uid,
        from: addressText(parsed.from) || addressText(message.envelope?.from),
        to,
        subject,
        date: isoDate(parsed.date ?? message.envelope?.date),
        text,
        html,
        codes: extractCodes(subject, text || html || ''),
        links: extractLinks(subject, text, html),
        ...(options.withHeaders
          ? { headers: headerByUid.get(message.uid) ?? headerBlock(message.source) }
          : {}),
      });
    }
  } finally {
    lock.release();
  }

  return results.sort((a, b) => b.date.localeCompare(a.date));
}
