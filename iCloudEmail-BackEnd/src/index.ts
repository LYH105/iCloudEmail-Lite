import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { logger } from './logger.js';
import { buildServer } from './api/server.js';
import { startSessionKeeper, stopSessionKeeper } from './services/sessionKeeper.js';
import { startMarkScanner, stopMarkScanner } from './services/markScanner.js';
import {
  startAutoCreateScheduler,
  stopAutoCreateScheduler,
} from './services/autoCreateScheduler.js';
import {
  startAliasSyncScheduler,
  stopAliasSyncScheduler,
} from './services/aliasSyncScheduler.js';

async function main(): Promise<void> {
  // Initialize (and migrate) the database before accepting traffic.
  getDb();

  const app = buildServer();
  await app.listen({ port: config.port, host: config.host });
  logger.info(`iCloud HME Manager API listening on http://${config.host}:${config.port}`);

  // Keep iCloud sessions warm in the background so they don't expire.
  startSessionKeeper();
  // Scan inboxes on a timer to apply alias mark rules automatically.
  startMarkScanner();
  // Auto-create: per-account opt-in, tops each enabled account back up to 5
  // aliases 65 minutes after its newest one.
  startAutoCreateScheduler();
  // Keep the 邮箱库 (alias library) in sync with Apple without a manual button.
  startAliasSyncScheduler();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down`);
    stopSessionKeeper();
    stopMarkScanner();
    stopAutoCreateScheduler();
    stopAliasSyncScheduler();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', err);
  process.exit(1);
});
