import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScope } from '../auth.js';
import { parse } from '../errors.js';
import * as keys from '../../services/apiKeyService.js';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.enum(['read', 'write'])).min(1).optional(),
});

/**
 * Allow the very first key to be created without authentication (bootstrap);
 * once any key exists, creation requires an authenticated write-scoped key.
 */
async function authOrBootstrap(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!keys.hasAnyApiKey()) return;
  await authenticate(req, reply);
  await requireScope('write')(req, reply);
}

export async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };
  const write = { preHandler: [authenticate, requireScope('write')] };

  // Public: lets the console decide whether to show the bootstrap screen.
  app.get('/bootstrap', async () => ({ needsBootstrap: !keys.hasAnyApiKey() }));

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
