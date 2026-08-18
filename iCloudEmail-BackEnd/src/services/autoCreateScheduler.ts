import { getDb } from '../db/index.js';
import { logger } from '../logger.js';
import { createBatch } from './aliasService.js';
import { logAutoCreateAttempt } from './autoCreateLogService.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Per-account cadence: top an account back up 65 minutes after its newest alias. */
export const AUTO_CREATE_INTERVAL_MS = 65 * 60_000;
const AUTO_CREATE_COUNT = 5;
const AUTO_CREATE_LABEL = 'AI注册';
export const AUTO_CREATE_DAILY_LIMIT = 25;
const RETRY_BASE_MS = 10 * 60_000;
const RETRY_MAX_MS = 6 * 60 * 60_000;

interface DueAccount {
  id: string;
  label: string;
  /** Newest alias creation time for THIS account (0 = no dated aliases yet). */
  newest: number;
  failures: number;
  nextAttemptAt: number;
  createdLast24h: number;
}

/** Active accounts with auto-create turned on, each with its newest alias time. */
function enabledAccounts(): DueAccount[] {
  return getDb()
    .prepare(
      `SELECT a.id, a.label,
              COALESCE((SELECT MAX(create_timestamp) FROM aliases WHERE account_id = a.id), 0) AS newest,
              a.auto_create_failures AS failures,
              COALESCE(a.auto_create_next_attempt_at, 0) AS nextAttemptAt,
              COALESCE((SELECT SUM(created_count) FROM auto_create_logs
                         WHERE account_id = a.id AND created_at >= ?), 0) AS createdLast24h
         FROM accounts a
        WHERE a.status = 'active' AND a.auto_create_enabled = 1 AND a.disabled = 0`,
    )
    .all(Date.now() - 24 * 60 * 60_000) as DueAccount[];
}

async function runForAccount(acc: DueAccount): Promise<void> {
  const db = getDb();
  try {
    const remaining = AUTO_CREATE_DAILY_LIMIT - acc.createdLast24h;
    const r = await createBatch(acc.id, Math.min(AUTO_CREATE_COUNT, remaining), AUTO_CREATE_LABEL);
    logger.info(`[autocreate] ${acc.label}: +${r.created.length} 别名（${r.errors.length} 失败）`);
    logAutoCreateAttempt(
      acc.id,
      r.created.length > 0,
      r.created.length,
      r.errors.length,
      r.errors.length ? r.errors.map((e) => e.message).slice(0, 3).join('; ').slice(0, 300) : null,
    );
    if (r.created.length > 0) {
      db.prepare(
        'UPDATE accounts SET auto_create_failures = 0, auto_create_next_attempt_at = ?, updated_at = ? WHERE id = ?',
      ).run(Date.now() + AUTO_CREATE_INTERVAL_MS, Date.now(), acc.id);
      return;
    }
    scheduleRetry(acc.id, acc.failures + 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[autocreate] ${acc.label}: ${message}`);
    logAutoCreateAttempt(acc.id, false, 0, 0, message.slice(0, 300));
    scheduleRetry(acc.id, acc.failures + 1);
  }
}

function scheduleRetry(accountId: string, failures: number): void {
  const delay = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, failures - 1), RETRY_MAX_MS);
  const now = Date.now();
  getDb()
    .prepare(
      'UPDATE accounts SET auto_create_failures = ?, auto_create_next_attempt_at = ?, updated_at = ? WHERE id = ?',
    )
    .run(failures, now + delay, now, accountId);
}

/**
 * When an account's next auto-create batch is due (epoch ms), or null when
 * auto-create is off for it or the account isn't active. An account whose
 * newest alias is already older than the interval reports "now".
 */
export function nextRunAtForAccount(accountId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT COALESCE((SELECT MAX(create_timestamp) FROM aliases WHERE account_id = a.id), 0) AS newest,
              COALESCE(a.auto_create_next_attempt_at, 0) AS nextAttemptAt,
              COALESCE((SELECT SUM(created_count) FROM auto_create_logs
                         WHERE account_id = a.id AND created_at >= ?), 0) AS createdLast24h,
              (SELECT MIN(created_at) FROM auto_create_logs
                WHERE account_id = a.id AND created_count > 0 AND created_at >= ?) AS oldestRecentCreate
         FROM accounts a
        WHERE a.id = ? AND a.status = 'active' AND a.auto_create_enabled = 1 AND a.disabled = 0`,
    )
    .get(Date.now() - 24 * 60 * 60_000, Date.now() - 24 * 60 * 60_000, accountId) as
    | { newest: number; nextAttemptAt: number; createdLast24h: number; oldestRecentCreate: number | null }
    | undefined;
  if (!row) return null;
  if (row.createdLast24h >= AUTO_CREATE_DAILY_LIMIT && row.oldestRecentCreate) {
    return row.oldestRecentCreate + 24 * 60 * 60_000;
  }
  return Math.max(row.newest + AUTO_CREATE_INTERVAL_MS, row.nextAttemptAt, Date.now());
}

/**
 * One pass: each account with auto-create enabled is timed off its own
 * newest alias — once that alias is older than 65 minutes (e.g. last created
 * 22:30 → due 23:35), a fresh batch of 5 is created for that account.
 * Accounts with no dated aliases yet are due immediately.
 */
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    for (const acc of enabledAccounts()) {
      if (now - acc.newest < AUTO_CREATE_INTERVAL_MS) continue;
      if (acc.nextAttemptAt > now) continue;
      if (acc.createdLast24h >= AUTO_CREATE_DAILY_LIMIT) continue;
      await runForAccount(acc);
    }
  } catch (err) {
    logger.warn(`[autocreate] tick failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running = false;
  }
}

/**
 * Runtime-controlled scheduler: a cheap 60s tick fires whichever accounts
 * (with auto-create enabled) are due, so toggling an account's switch takes
 * effect without a restart.
 */
export function startAutoCreateScheduler(): void {
  // First check shortly after boot, then on the 60s tick.
  setTimeout(() => void tick(), 20_000).unref();
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  logger.info('[autocreate] scheduler ready (per-account, 65min cadence off each newest alias)');
}

export function stopAutoCreateScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
