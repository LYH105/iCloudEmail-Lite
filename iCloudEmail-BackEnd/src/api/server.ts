import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from '../config.js';
import { errorHandler } from './errors.js';
import { accountRoutes } from './routes/accounts.js';
import { aliasRoutes } from './routes/aliases.js';
import { aliasLibraryRoutes } from './routes/aliasLibrary.js';
import { apiKeyRoutes } from './routes/apikeys.js';
import { autoCreateLogRoutes } from './routes/autoCreateLogs.js';
import { imapRoutes } from './routes/imap.js';
import { markRuleRoutes } from './routes/markRules.js';
import { overviewRoutes } from './routes/overview.js';

// Keep this policy aligned with iCloudEmail-FrontEnd/index.html. It deliberately
// permits local Vite/WebSocket connections and the opt-in release check while
// still allowing the sandboxed srcDoc email viewer to be framed by the app.
export const STATIC_UI_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* " +
  'http://localhost:* ws://127.0.0.1:* ws://localhost:* https://api.github.com; ' +
  "frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

export function buildServer(): FastifyInstance {
  const webEnabled = Boolean(config.webDist && existsSync(config.webDist));
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : config.isProduction
          ? true
          : { transport: { target: 'pino-pretty', options: { colorize: true } } },
    bodyLimit: 1_048_576,
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');

    const path = req.url.split('?', 1)[0] ?? req.url;
    const isApi = path === '/api' || path.startsWith('/api/');
    const isHealth = path === '/health';
    if (isApi || isHealth) {
      reply.header('Cache-Control', 'no-store');
    } else if (webEnabled) {
      // Only the backend-served production UI gets this header. Vite remains
      // responsible for its own development responses and HMR connection.
      reply.header('Content-Security-Policy', STATIC_UI_CSP);
    }
  });

  app.setErrorHandler(errorHandler);

  // Tolerate empty-body POSTs that still send `Content-Type: application/json`
  // (e.g. sync/generate/deactivate) instead of rejecting them.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const raw = (body as string).trim();
    if (!raw) return done(null, {});
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.register(cors, {
    origin: config.corsOrigins.length ? config.corsOrigins : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  });

  app.get('/health', async () => ({ status: 'ok', name: 'icloud-hme-manager' }));

  // Public runtime config so the UI knows whether to require an API key.
  app.get('/api/config', async () => ({ authDisabled: config.authDisabled }));

  app.register(apiKeyRoutes, { prefix: '/api/apikeys' });
  app.register(accountRoutes, { prefix: '/api/accounts' });
  app.register(aliasRoutes, { prefix: '/api/accounts/:accountId/aliases' });
  app.register(aliasLibraryRoutes, { prefix: '/api/aliases' });
  app.register(imapRoutes, { prefix: '/api/imap' });
  app.register(autoCreateLogRoutes, { prefix: '/api/auto-create-logs' });
  app.register(markRuleRoutes, { prefix: '/api/mark-rules' });
  app.register(overviewRoutes, { prefix: '/api/overview' });

  // Serve the built web UI (React) at / so the whole app runs same-origin.
  if (webEnabled) {
    app.register(fastifyStatic, { root: config.webDist!, prefix: '/' });
  }

  // SPA fallback when the web build is mounted; otherwise every unknown route
  // still receives the same structured API error envelope.
  app.setNotFoundHandler((req, reply) => {
    if (webEnabled && req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
      return reply.sendFile('index.html', config.webDist!);
    }
    reply.code(404).send({
      error: '资源不存在',
      code: 'NOT_FOUND',
      requestId: req.id,
    });
  });

  return app;
}
