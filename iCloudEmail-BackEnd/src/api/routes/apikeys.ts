import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as keys from '../../services/apiKeyService.js';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z
    .array(z.enum(['read', 'write']))
    .min(1)
    .optional(),
});

/**
 * Allow recovery bootstrap only while no active write-scoped key exists;
 * otherwise creation requires an authenticated write-scoped key.
 */
async function authOrBootstrap(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (config.authDisabled) {
    await authenticate(req, reply);
    await requireScope('write')(req, reply);
    return;
  }
  if (!keys.hasActiveWriteApiKey()) return;
  await authenticate(req, reply);
  await requireScope('write')(req, reply);
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  // Public: lets the console decide whether to show the bootstrap screen.
  app.get('/bootstrap', async () => ({ needsBootstrap: !keys.hasActiveWriteApiKey() }));

  app.get('/', read, async () => ({ apiKeys: keys.listApiKeys() }));

  app.post('/', { preHandler: [authOrBootstrap] }, async (req) => {
    const body = parse(createSchema, req.body);
    return { apiKey: keys.createApiKey(body.name, body.scopes) };
  });

  app.post<{ Params: { id: string } }>('/:id/revoke', write, async (req) => ({
    revoked: keys.revokeApiKey(req.params.id),
  }));

  app.delete<{ Params: { id: string } }>('/:id', write, async (req) => ({
    deleted: keys.deleteApiKey(req.params.id),
  }));
}
