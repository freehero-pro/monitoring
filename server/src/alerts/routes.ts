import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { notificationChannels, webhookDeliveries } from '../db/schema.js';
import { requireAdmin } from '../auth/guards.js';
import { dispatchEvents } from './webhook.js';

const EVENT_NAMES = ['incident.opened', 'incident.resolved', 'cert.expiring'] as const;

const channelInput = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().url(),
  secret: z.string().max(200).nullable().default(null),
  events: z.array(z.enum(EVENT_NAMES)).min(1).default([...EVENT_NAMES]),
  enabled: z.boolean().default(true),
});

const idParam = z.object({ id: z.string().uuid() });

export function channelsRoutes(deps: { db: Database }) {
  const { db } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    // Каналы содержат секреты подписи, поэтому доступны только администратору.
    app.addHook('preHandler', requireAdmin);

    app.get('/', async () => ({
      channels: await db.select().from(notificationChannels).orderBy(notificationChannels.name),
      deliveries: await db
        .select()
        .from(webhookDeliveries)
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(20),
    }));

    app.post('/', async (request, reply) => {
      const parsed = channelInput.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректные данные', details: parsed.error.issues });
      }
      const [created] = await db.insert(notificationChannels).values(parsed.data).returning();
      return reply.code(201).send({ channel: created });
    });

    app.patch('/:id', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const parsed = channelInput.partial().safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Некорректные данные', details: parsed.error.issues });
      }

      const [updated] = await db
        .update(notificationChannels)
        .set(parsed.data)
        .where(eq(notificationChannels.id, params.data.id))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'Канал не найден' });

      return { channel: updated };
    });

    app.delete('/:id', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const deleted = await db
        .delete(notificationChannels)
        .where(eq(notificationChannels.id, params.data.id))
        .returning({ id: notificationChannels.id });
      if (deleted.length === 0) return reply.code(404).send({ error: 'Канал не найден' });

      return reply.code(204).send();
    });

    // Тестовая отправка помогает убедиться, что приёмник принимает подпись и формат.
    app.post('/:id/test', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: 'Некорректный идентификатор' });

      const [channel] = await db
        .select()
        .from(notificationChannels)
        .where(eq(notificationChannels.id, params.data.id));
      if (!channel) return reply.code(404).send({ error: 'Канал не найден' });

      await dispatchEvents(
        db,
        [
          {
            type: 'incident.opened',
            check: testCheck(),
            incident: testIncident(),
          },
        ],
        { attempts: 1, channelIds: [channel.id] },
      );

      const [delivery] = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.channelId, channel.id))
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(1);

      return { delivery };
    });
  };
}

function testCheck() {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    name: 'Тестовое событие',
    url: 'https://example.test/health',
    tags: ['test'],
  } as never;
}

function testIncident() {
  return {
    id: null,
    startedAt: new Date(),
    resolvedAt: null,
    firstErrorKind: 'http',
    lastErrorMessage: 'Проверка доставки webhook',
    failedResultsCount: 1,
  } as never;
}
