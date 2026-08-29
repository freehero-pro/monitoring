import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import type { Config } from '../config.js';
import { checkChannels, checks, tlsCertificates } from '../db/schema.js';
import { requireAdmin, requireUser } from '../auth/guards.js';
import { checkInputSchema, checkUpdateSchema } from './schema.js';
import { runCheck } from '../runner/scheduler.js';
import { dispatchEvents } from '../alerts/webhook.js';
import {
  incidentsForCheck,
  listChecksWithStats,
  parseRange,
  recentResults,
  timeSeries,
} from '../stats/queries.js';

const idParam = z.object({ id: z.string().uuid() });

export function checksRoutes(deps: { db: Database; config: Config }) {
  const { db, config } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    app.addHook('preHandler', requireUser);

    app.get('/', async () => ({ checks: await listChecksWithStats(db) }));

    app.get('/:id', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const [check] = await db.select().from(checks).where(eq(checks.id, params.data.id));
      if (!check) return reply.code(404).send({ error: 'Проверка не найдена' });

      const [certificate] = await db
        .select()
        .from(tlsCertificates)
        .where(eq(tlsCertificates.checkId, check.id));
      const channels = await db
        .select({ channelId: checkChannels.channelId })
        .from(checkChannels)
        .where(eq(checkChannels.checkId, check.id));

      return {
        check: { ...check, channelIds: channels.map((row) => row.channelId) },
        certificate: certificate ?? null,
        lastResults: await recentResults(db, check.id, 20),
        incidents: await incidentsForCheck(db, check.id, 20),
      };
    });

    app.get('/:id/results', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });
      const limit = Number((request.query as { limit?: string }).limit ?? 100);
      return { results: await recentResults(db, params.data.id, Math.min(limit, 500)) };
    });

    app.get('/:id/stats', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });
      const range = parseRange((request.query as { range?: string }).range);
      return { range, series: await timeSeries(db, params.data.id, range) };
    });

    app.get('/:id/incidents', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });
      return { incidents: await incidentsForCheck(db, params.data.id) };
    });

    app.post('/', { preHandler: requireAdmin }, async (request, reply) => {
      const parsed = checkInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректные данные', details: parsed.error.issues });
      }

      const { channelIds, ...values } = parsed.data;
      const [created] = await db
        .insert(checks)
        .values({ ...values, nextRunAt: new Date() })
        .returning();
      await replaceChannels(db, created!.id, channelIds);

      return reply.code(201).send({ check: created });
    });

    app.patch('/:id', { preHandler: requireAdmin }, async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const parsed = checkUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректные данные', details: parsed.error.issues });
      }

      const { channelIds, ...values } = parsed.data;
      const [updated] = await db
        .update(checks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(checks.id, params.data.id))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'Проверка не найдена' });
      if (channelIds) await replaceChannels(db, updated.id, channelIds);

      return { check: updated };
    });

    app.delete('/:id', { preHandler: requireAdmin }, async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const deleted = await db
        .delete(checks)
        .where(eq(checks.id, params.data.id))
        .returning({ id: checks.id });
      if (deleted.length === 0) return reply.code(404).send({ error: 'Проверка не найдена' });

      return reply.code(204).send();
    });

    // «Проверить сейчас»: тот же путь, что и у планировщика, поэтому результат
    // попадает в историю и может закрыть инцидент.
    app.post('/:id/run', { preHandler: requireAdmin }, async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const [check] = await db.select().from(checks).where(eq(checks.id, params.data.id));
      if (!check) return reply.code(404).send({ error: 'Проверка не найдена' });

      const { result, events } = await runCheck(db, check, {
        batchSize: config.SCHEDULER_BATCH_SIZE,
        maxConcurrent: config.MAX_CONCURRENT_CHECKS,
        maxResponseBytes: config.MAX_RESPONSE_BYTES,
        tlsWarnDays: config.TLS_WARN_DAYS,
      });
      await dispatchEvents(db, events);

      return { result };
    });
  };
}

async function replaceChannels(db: Database, checkId: string, channelIds: string[]): Promise<void> {
  await db.delete(checkChannels).where(eq(checkChannels.checkId, checkId));
  if (channelIds.length === 0) return;
  await db
    .insert(checkChannels)
    .values(channelIds.map((channelId) => ({ checkId, channelId })));
}
