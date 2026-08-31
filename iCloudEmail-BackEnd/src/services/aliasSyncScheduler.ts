import { logger } from '../logger.js';
import { syncAllAccounts } from './aliasService.js';

let timer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;
let running = false;

/** One pass: pull the live alias list from Apple for every active account. */
async function syncAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await syncAllAccounts();
    logger.info(
      `[aliassync] synced ${r.synced} 个账户${r.errors.length ? ` · ${r.errors.length} 个失败` : ''}`,
    );
  } catch (err) {
    logger.warn(`[aliassync] pass failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    running = false;
  }
}

/**
 * Keep the local alias cache (the "邮箱库") in sync with Apple without a
 * manual button: new aliases created via auto-create are already written
 * locally the moment they're made, but this catches anything that changed
 * on Apple's side directly (deactivated/deleted via the official app, etc.).
 */
export function startAliasSyncScheduler(): void {
  stopAliasSyncScheduler();
  startupTimer = setTimeout(() => void syncAll(), 30_000);
  startupTimer.unref();
  timer = setInterval(() => void syncAll(), 30 * 60_000);
  timer.unref();
  logger.info('[aliassync] scheduler ready (refreshing every active account every 30 min)');
}

export function stopAliasSyncScheduler(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (timer) clearInterval(timer);
  startupTimer = null;
  timer = null;
}
