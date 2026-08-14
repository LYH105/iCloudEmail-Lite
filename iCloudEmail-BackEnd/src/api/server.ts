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

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: config.isProduction
      ? true
      : { transport: { target: 'pino-pretty', options: { colorize: true } } },
    bodyLimit: 1_048_576,
  });

  app.setErrorHandler(errorHandler);

  // Tolerate empty-body POSTs that still send `Content-Type: application/json`
  // (e.g. sync/generate/deactivate) instead of rejecting them.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const raw = (body as string).trim();
      if (!raw) return done(null, {});
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        (err as { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    },
  );

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

  // Serve the built web UI (React) at / so the whole app runs same-origin.
  const webEnabled = Boolean(config.webDist && existsSync(config.webDist));

  if (webEnabled) {
    app.register(fastifyStatic, { root: config.webDist!, prefix: '/' });

    // SPA fallback: any non-API GET falls through to the React index.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
        return reply.sendFile('index.html', config.webDist!);
      }
      reply.code(404).send({ error: 'Not found' });
    });
  }

  return app;
}
