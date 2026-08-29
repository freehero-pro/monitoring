import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';
import { requireUser } from '../auth/guards.js';
import { listCertificates, listIncidents } from './queries.js';

export function statsRoutes(deps: { db: Database }) {
  const { db } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', requireUser);

    app.get('/incidents', async (request) => {
      const openOnly = (request.query as { open?: string }).open === 'true';
      return { incidents: await listIncidents(db, { openOnly }) };
    });

    app.get('/certificates', async () => ({ certificates: await listCertificates(db) }));
  };
}
