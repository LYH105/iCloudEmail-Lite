import { timingSafeEqual } from 'node:crypto';
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

export const DESKTOP_COOKIE_NAME = 'icloud_hme_desktop';

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function desktopCookieMatches(cookieHeader: string | undefined, expected: string): boolean {
  const actual = cookieValue(cookieHeader, DESKTOP_COOKIE_NAME);
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** preHandler: authenticate the request via API key and attach scopes. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  // Explicit local development mode can stay keyless. The Electron shell adds
  // a per-launch HttpOnly cookie so unrelated local processes do not inherit
  // that trust merely by discovering the random listening port.
  if (config.authDisabled) {
    if (config.desktopInstanceId && !desktopCookieMatches(req.headers.cookie, config.desktopInstanceId)) {
      throw unauthorized('桌面会话无效，请重新启动应用');
    }
    req.apiScopes = ['read', 'write'];
    return;
  }
  const key = extractKey(req);
  if (!key) throw unauthorized('缺少 API Key');
  const verified = verifyApiKey(key);
  if (!verified) throw unauthorized('API Key 无效或已撤销');
  req.apiScopes = verified.scopes;
}

/** preHandler factory: require a specific scope (after authenticate). */
export function requireScope(scope: Scope) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!req.apiScopes?.includes(scope)) {
      throw forbidden(`当前 API Key 缺少 ${scope} 权限`);
    }
  };
}
