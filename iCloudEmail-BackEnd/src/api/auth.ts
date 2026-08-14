import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { verifyApiKey, type Scope } from '../services/apiKeyService.js';
import { forbidden, unauthorized } from './errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    apiScopes?: Scope[];
  }
}

function extractKey(req: FastifyRequest): string | null {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
  const header = req.headers['x-api-key'];
  if (typeof header === 'string' && header) return header.trim();
  return null;
}

/** preHandler: authenticate the request via API key and attach scopes. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Local-only mode: grant full access without a key.
  if (config.authDisabled) {
    req.apiScopes = ['read', 'write'];
    return;
  }
  const key = extractKey(req);
  if (!key) throw unauthorized('Missing API key');
  const verified = verifyApiKey(key);
  if (!verified) throw unauthorized('Invalid or revoked API key');
  req.apiScopes = verified.scopes;
}

/** preHandler factory: require a specific scope (after authenticate). */
export function requireScope(scope: Scope) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.apiScopes?.includes(scope)) {
      throw forbidden(`This API key lacks the '${scope}' scope`);
    }
  };
}
