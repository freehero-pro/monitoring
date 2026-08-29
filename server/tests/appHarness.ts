import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { users } from '../src/db/schema.js';
import { connectTestDatabase, testDatabaseUrl } from './db.js';
import type { Database } from '../src/db/client.js';

export type SentLetter = { email: string; link: string };

export type Harness = {
  app: FastifyInstance;
  db: Database;
  config: Config;
  sent: SentLetter[];
  close: () => Promise<void>;
  /** Создаёт пользователя и возвращает cookie активной сессии. */
  login: (email: string, role?: 'admin' | 'viewer') => Promise<string>;
};

export const APP_ORIGIN = 'http://localhost:5173';

export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const { pool, db } = connectTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl(),
    APP_BASE_URL: APP_ORIGIN,
    SCHEDULER_ENABLED: 'false',
    // Лимит по IP проверяется отдельным тестом; здесь он мешал бы логиниться в каждом кейсе.
    AUTH_IP_RATE_LIMIT: '1000',
    ...env,
  } as NodeJS.ProcessEnv);

  const sent: SentLetter[] = [];
  const app = await buildApp({
    db,
    config,
    mailer: {
      async sendMagicLink(email, link) {
        sent.push({ email, link });
      },
    },
  });

  async function login(email: string, role: 'admin' | 'viewer' = 'admin'): Promise<string> {
    await db.insert(users).values({ email, role });

    const requested = await app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email },
    });
    if (requested.statusCode !== 200) throw new Error('Не удалось запросить ссылку');

    const letter = sent.at(-1);
    if (!letter) throw new Error('Письмо со ссылкой не отправлено');

    const token = new URL(letter.link).searchParams.get('token');
    const callback = await app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` });
    const cookie = callback.cookies.find((item) => item.name === 'monitoring_session');
    if (!cookie) throw new Error('Сессионная cookie не установлена');

    return `${cookie.name}=${cookie.value}`;
  }

  return {
    app,
    db,
    config,
    sent,
    login,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
