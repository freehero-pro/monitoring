import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Config } from '../config.js';
import type { Mailer } from './mailer.js';
import { consumeMagicLink, issueMagicLink } from './magicLink.js';
import { createSession, destroySession, SESSION_COOKIE } from './session.js';
import { requireUser } from './guards.js';

const magicLinkBody = z.object({ email: z.string().email() });

const CALLBACK_ERRORS: Record<string, string> = {
  invalid: 'link_invalid',
  expired: 'link_expired',
  used: 'link_used',
  inactive: 'user_inactive',
};

export function authRoutes(deps: { db: Database; config: Config; mailer: Mailer }) {
  const { db, config, mailer } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    app.post(
      '/magic-link',
      { config: { rateLimit: { max: config.AUTH_IP_RATE_LIMIT, timeWindow: '1 hour' } } },
      async (request, reply) => {
        const parsed = magicLinkBody.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: 'Укажите корректный email' });
        }

        const result = await issueMagicLink(db, parsed.data.email, {
          ttlMinutes: config.MAGIC_LINK_TTL_MINUTES,
          ip: request.ip,
        });

        if (result.status === 'issued') {
          const link = `${config.APP_BASE_URL}/api/auth/callback?token=${encodeURIComponent(result.token)}`;
          try {
            await mailer.sendMagicLink(result.user.email, link);
          } catch (error) {
            request.log.error({ err: error }, 'Не удалось отправить письмо со ссылкой');
          }
        }

        // Ответ одинаков во всех случаях: наличие аккаунта не должно утекать наружу.
        return reply.send({ status: 'sent' });
      },
    );

    app.get('/callback', async (request, reply) => {
      const token = (request.query as { token?: string }).token;
      if (!token) return reply.redirect(`${config.APP_BASE_URL}/login?error=link_invalid`);

      const result = await consumeMagicLink(db, token);
      if (result.status !== 'ok') {
        const reason = CALLBACK_ERRORS[result.status] ?? 'link_invalid';
        return reply.redirect(`${config.APP_BASE_URL}/login?error=${reason}`);
      }

      const sessionToken = await createSession(db, result.user.id, {
        ttlDays: config.SESSION_TTL_DAYS,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply
        .setCookie(SESSION_COOKIE, sessionToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure: config.cookieSecure,
          path: '/',
          maxAge: config.SESSION_TTL_DAYS * 86_400,
        })
        .redirect(`${config.APP_BASE_URL}/`);
    });

    app.post('/logout', async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE];
      if (token) await destroySession(db, token);
      return reply.clearCookie(SESSION_COOKIE, { path: '/' }).send({ status: 'ok' });
    });

    app.get('/me', { preHandler: requireUser }, async (request) => ({
      id: request.currentUser!.id,
      email: request.currentUser!.email,
      role: request.currentUser!.role,
    }));
  };
}
