import type { FastifyInstance } from 'fastify';
import { authenticate, requireScope } from '../auth.js';
import { getOverview } from '../../services/overviewService.js';

export async function overviewRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [authenticate, requireScope('read')] }, async () => getOverview());
}
