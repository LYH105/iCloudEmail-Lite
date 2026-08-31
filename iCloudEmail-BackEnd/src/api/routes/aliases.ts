import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as aliases from '../../services/aliasService.js';
import * as marks from '../../services/markService.js';

const reserveSchema = z.object({
  hme: z.string().email(),
  label: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
});

const createSchema = z.object({
  label: z.string().min(1).max(120),
  note: z.string().max(500).optional(),
});

const batchSchema = z.object({
  count: z.number().int().min(1).max(25),
  label: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});

const mailQuerySchema = z.object({
  sinceMinutes: z.coerce.number().int().positive().max(20160).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const forwardSchema = z.object({ forwardToEmail: z.string().email() });

const scanSchema = z.object({
  sinceMinutes: z.coerce.number().int().positive().max(43200).optional(),
});

const usedSchema = z.object({ used: z.boolean() });

/** Mounted under /api/accounts/:accountId/aliases */
export async function aliasRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  type P = { Params: { accountId: string } };
  type PA = { Params: { accountId: string; anonymousId: string } };

  // Local cached aliases (fast, no Apple call).
  app.get<P>('/', read, async (req) => ({ aliases: aliases.listLocal(req.params.accountId) }));

  // Live sync from Apple + refresh cache.
  app.post<P>('/sync', write, async (req) => aliases.sync(req.params.accountId));

  // Set the account-wide forwarding destination (applies to all aliases).
  app.post<P>('/forward-to', write, async (req) => {
    const { forwardToEmail } = parse(forwardSchema, req.body);
    return aliases.setForwardTo(req.params.accountId, forwardToEmail);
  });

  // Generate an unreserved address.
  app.post<P>('/generate', write, async (req) => aliases.generate(req.params.accountId));

  // Reserve a specific generated address.
  app.post<P>('/reserve', write, async (req) => {
    const body = parse(reserveSchema, req.body);
    return { alias: await aliases.reserve(req.params.accountId, body.hme, body.label, body.note) };
  });

  // Generate + reserve in one step.
  app.post<P>('/', write, async (req) => {
    const body = parse(createSchema, req.body);
    return { alias: await aliases.create(req.params.accountId, body.label, body.note) };
  });

  // Batch generate + reserve N aliases (default use case: 5 at once).
  app.post<P>('/batch', write, async (req) => {
    const body = parse(batchSchema, req.body);
    return aliases.createBatch(req.params.accountId, body.count, body.label, body.note);
  });

  app.post<PA>('/:anonymousId/deactivate', write, async (req) => ({
    alias: await aliases.deactivate(req.params.accountId, req.params.anonymousId),
  }));

  app.post<PA>('/:anonymousId/reactivate', write, async (req) => ({
    alias: await aliases.reactivate(req.params.accountId, req.params.anonymousId),
  }));

  // Manually mark an alias as used/unused (local-only, no Apple call).
  app.patch<PA>('/:anonymousId/used', write, async (req) => {
    const { used } = parse(usedSchema, req.body);
    return { alias: aliases.setUsed(req.params.accountId, req.params.anonymousId, used) };
  });

  app.delete<PA>('/:anonymousId', write, async (req) =>
    aliases.remove(req.params.accountId, req.params.anonymousId),
  );

  // Recent inbox mail addressed to this specific alias (with detected codes).
  app.get<PA>('/:anonymousId/mail', read, async (req) => {
    const q = parse(mailQuerySchema, req.query);
    return aliases.fetchMail(req.params.accountId, req.params.anonymousId, q);
  });

  // Scan the account's inbox and apply mark rules (已注册/已开通…).
  app.post<P>('/scan-marks', write, async (req) => {
    const q = parse(scanSchema, req.query);
    return marks.scanAccount(req.params.accountId, q.sinceMinutes);
  });
}
