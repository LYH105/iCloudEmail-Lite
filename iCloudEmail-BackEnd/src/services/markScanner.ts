import { config } from '../config.js';
import { logger } from '../logger.js';
import { scanAllAccounts } from './markService.js';

let timer: NodeJS.Timeout | null = null;
let running = false;

/** One pass: scan the inbox of every account that has an IMAP mailbox. */
async function scanAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const r = await scanAllAccounts();
    logger.info(`[scanner] ${r.scanned} 封邮件 · ${r.updated.length} 个标记变更`);
  } finally {
    running = false;
  }
}

/**
 * Periodically scan inboxes and apply mark rules to aliases, so freshly
 * arrived registration/activation mail marks its alias without a manual
 * scan. Interval via MARK_SCAN_MINUTES (0 disables).
 */
export function startMarkScanner(): void {
  const minutes = config.markScanMinutes;
  if (minutes <= 0) {
    logger.info('[scanner] disabled (MARK_SCAN_MINUTES=0)');
    return;
  }
  setTimeout(() => void scanAll(), 90_000).unref();
  timer = setInterval(() => void scanAll(), minutes * 60_000);
  timer.unref();
  logger.info(`[scanner] mark scanner: scanning inboxes every ${minutes} min`);
}

export function stopMarkScanner(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
