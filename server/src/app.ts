import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import type { Database } from './db/client.js';
import type { Config } from './config.js';
import { createMailer, type Mailer } from './auth/mailer.js';
import { authRoutes } from './auth/routes.js';
import { resolveSession, SESSION_COOKIE } from './auth/session.js';
import { checksRoutes } from './checks/routes.js';
import { statsRoutes } from './stats/routes.js';
import { channelsRoutes } from './alerts/routes.js';

export type AppDeps = {
  db: Database;
  config: Config;
  /** В тестах подменяется на перехватчик писем; в проде создаётся из конфигурации. */
  mailer?: Mailer;
  logger?: FastifyServerOptions['logger'];
};

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, config } = deps;
  const app = Fastify({ logger: deps.logger ?? false, trustProxy: true });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorateRequest('currentUser', null);

  // Сессия разбирается один раз на запрос: гардам остаётся только проверить роль.
  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    request.currentUser = token ? await resolveSession(db, token) : null;
  });

  // Cookie помечена SameSite=lax, поэтому от CSRF защищает ещё и сверка Origin.
  const allowedOrigin = new URL(config.APP_BASE_URL).origin;
  app.addHook('onRequest', async (request, reply) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (!request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin && origin !== allowedOrigin) {
      await reply.code(403).send({ error: 'Запрос с недопустимого источника' });
    }
  });

  app.get('/health', async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok' };
  });

  const mailer = deps.mailer ?? createMailer(config, app.log);
  await app.register(authRoutes({ db, config, mailer }), { prefix: '/api/auth' });
  await app.register(checksRoutes({ db, config }), { prefix: '/api/checks' });
  await app.register(statsRoutes({ db }), { prefix: '/api' });
  await app.register(channelsRoutes({ db }), { prefix: '/api/channels' });

  await registerFrontend(app);

  return app;
}

/** В проде тот же процесс отдаёт собранный фронт: один контейнер, один порт. */
async function registerFrontend(app: FastifyInstance): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (!fs.existsSync(path.join(root, 'index.html'))) return;

  await app.register(fastifyStatic, { root });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.method !== 'GET') {
      return reply.code(404).send({ error: 'Не найдено' });
    }
    return reply.sendFile('index.html');
  });
}
