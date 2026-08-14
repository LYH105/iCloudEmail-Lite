import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as aliases from '../../services/aliasService.js';
import * as marks from '../../services/markService.js';

const libraryQuerySchema = z.object({
  sinceMinutes: z.coerce.number().int().positive().max(43200).optional(),
});

/**
 * Mounted under /api/aliases — cross-account view of the local alias cache
 * (the "邮箱库"). Generation stays account-scoped (see /api/accounts/:id/aliases);
 * this surface is for reading the pool and triggering an all-accounts refresh.
 */
export async function aliasLibraryRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  app.get('/', read, async () => ({ aliases: aliases.listAllLocal() }));

  // 总邮件库: one aggregate inbox across all aliases (default last 24h).
  app.get('/mail-library', read, async (req) => {
    const q = parse(libraryQuerySchema, req.query);
    return { messages: await aliases.listMailLibrary(q.sinceMinutes ?? 1440) };
  });

  // Manual override for the automatic background sync (aliasSyncScheduler).
  app.post('/sync', write, async () => aliases.syncAllAccounts());

  // Manual override for the automatic background scan (markScanner).
  app.post('/scan-marks', write, async () => marks.scanAllAccounts());
}
