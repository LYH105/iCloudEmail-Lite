import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as imap from '../../services/imapService.js';

const createSchema = z.object({
  accountId: z.string().uuid().nullable().optional(),
  label: z.string().min(1).max(120),
  host: z.string().min(1),
  port: z.number().int().positive().max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const fetchQuerySchema = z.object({
  mailbox: z.string().optional(),
  sinceMinutes: z.coerce.number().int().positive().max(10080).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  filterTo: z.string().optional(),
});

const adhocSchema = createSchema
  .omit({ accountId: true, label: true })
  .extend({ options: fetchQuerySchema.optional() });

export async function imapRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  app.get('/', read, async () => ({ configs: imap.listConfigs() }));

  app.post('/', write, async (req) => {
    const body = parse(createSchema, req.body);
    return { config: imap.createConfig(body) };
  });

  app.delete<{ Params: { id: string } }>('/:id', write, async (req) => ({
    deleted: imap.deleteConfig(req.params.id),
  }));

  app.post<{ Params: { id: string } }>('/:id/test', read, async (req) =>
    imap.testConfig(req.params.id),
  );

  // Fetch recent messages + detected codes for a stored config.
  app.get<{ Params: { id: string } }>('/:id/codes', read, async (req) => {
    const options = parse(fetchQuerySchema, req.query);
    return { messages: await imap.fetchCodes(req.params.id, options) };
  });

  // One-off fetch without persisting credentials.
  app.post('/fetch', write, async (req) => {
    const body = parse(adhocSchema, req.body);
    const { options, ...connection } = body;
    return {
      messages: await imap.fetchCodesAdhoc(
        {
          host: connection.host,
          port: connection.port ?? 993,
          secure: connection.secure !== false,
          username: connection.username,
          password: connection.password,
        },
        options ?? {},
      ),
    };
  });
}
