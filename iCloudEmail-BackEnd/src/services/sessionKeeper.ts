import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { logger } from '../logger.js';
import { keepAlive } from './accountService.js';

let timer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let running = false;

/**
 * One pass: cookie-refresh every ACTIVE account's profile. Expired accounts
 * are deliberately left alone — re-login is user-triggered (the login window
 * opens prefilled), never automatic.
 */
async function refreshAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const rows = getDb()
      .prepare("SELECT id, label FROM accounts WHERE status = 'active' AND disabled = 0")
      .all() as { id: string; label: string }[];
    for (const row of rows) {
      try {
        const outcome = await keepAlive(row.id);
        logger.info(`[keeper] ${row.label} (${row.id.slice(0, 8)}): ${outcome}`);
      } catch (err) {
        logger.warn(`[keeper] ${row.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    logger.warn(`[keeper] pass failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running = false;
  }
}

/**
 * Keep iCloud web sessions alive proactively: on a timer, relaunch each
 * account's persistent browser profile headlessly and hit setup/validate.
 * Apple rolls the session cookies forward on use, and the fresh cookies are
 * synced into the database — so sessions (almost) never expire in the first
 * place, instead of being rescued after the fact. Interval comes from
 * SESSION_REFRESH_MINUTES (0 disables the keeper).
 */
export function startSessionKeeper(): void {
  stopSessionKeeper();
  const minutes = config.sessionRefreshMinutes;
  if (minutes <= 0) {
    logger.info('[keeper] disabled (SESSION_REFRESH_MINUTES=0)');
    return;
  }
  // First pass shortly after boot (don't slow startup), then on the interval.
  startupTimer = setTimeout(() => void refreshAll(), 60_000);
  startupTimer.unref();
  timer = setInterval(() => void refreshAll(), minutes * 60_000);
  timer.unref();
  logger.info(`[keeper] iCloud session keeper: refreshing cookies every ${minutes} min`);
}

export function stopSessionKeeper(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (timer) clearInterval(timer);
  startupTimer = null;
  timer = null;
}
