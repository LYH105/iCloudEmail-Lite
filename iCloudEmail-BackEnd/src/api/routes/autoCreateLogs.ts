import type { FastifyInstance } from 'fastify';
import { authenticate, requireScope } from '../auth.js';
import { listAutoCreateLogs } from '../../services/autoCreateLogService.js';

export async function autoCreateLogRoutes(app: FastifyInstance): Promise<void> {
  const read = { preHandler: [authenticate, requireScope('read')] };

  app.get('/', read, async () => ({ logs: listAutoCreateLogs(50) }));
}
