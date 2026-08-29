import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { eq, inArray, sql } from 'drizzle-orm';
import { request } from 'undici';
import type { Database } from '../db/client.js';
import { checkChannels, notificationChannels, webhookDeliveries } from '../db/schema.js';
import type { MonitoringEvent } from './incidents.js';

export type ChannelRow = typeof notificationChannels.$inferSelect;

export type DeliveryOptions = {
  attempts: number;
  retryDelayMs: number;
  timeoutMs: number;
  /** Явный список каналов — используется кнопкой «отправить тестовое событие». */
  channelIds?: string[];
};

const DEFAULT_OPTIONS: DeliveryOptions = { attempts: 3, retryDelayMs: 1000, timeoutMs: 10_000 };

/**
 * Рассылает события в webhook-каналы. Никогда не бросает исключение: недоступный
 * приёмник — это его проблема, а не повод ронять цикл проверок. Все попытки видны
 * в `webhook_deliveries`.
 */
export async function dispatchEvents(
  db: Database,
  events: MonitoringEvent[],
  options: Partial<DeliveryOptions> = {},
): Promise<void> {
  const settings = { ...DEFAULT_OPTIONS, ...options };

  for (const event of events) {
    const channels = settings.channelIds
      ? await db
          .select()
          .from(notificationChannels)
          .where(inArray(notificationChannels.id, settings.channelIds))
      : await channelsFor(db, event.check.id, event.type);
    for (const channel of channels) {
      await deliver(db, channel, event, settings);
    }
  }
}

/**
 * Канал получает событие, если он привязан к этой проверке. Канал без единой привязки
 * считается общим и получает события всех проверок — так один webhook настраивается
 * в два клика, без ручной привязки к каждой проверке.
 */
async function channelsFor(
  db: Database,
  checkId: string,
  event: MonitoringEvent['type'],
): Promise<ChannelRow[]> {
  const rows = await db
    .select({ channel: notificationChannels })
    .from(notificationChannels)
    .where(
      sql`${notificationChannels.enabled}
        AND ${notificationChannels.events} ? ${event}
        AND (
          EXISTS (
            SELECT 1 FROM ${checkChannels}
            WHERE ${checkChannels.channelId} = ${notificationChannels.id}
              AND ${checkChannels.checkId} = ${checkId}
          )
          OR NOT EXISTS (
            SELECT 1 FROM ${checkChannels}
            WHERE ${checkChannels.channelId} = ${notificationChannels.id}
          )
        )`,
    );

  return rows.map((row) => row.channel);
}

async function deliver(
  db: Database,
  channel: ChannelRow,
  event: MonitoringEvent,
  options: DeliveryOptions,
): Promise<void> {
  const payload = buildPayload(event);
  const body = JSON.stringify(payload);

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      channelId: channel.id,
      incidentId: 'incident' in event ? event.incident.id : null,
      event: event.type,
      payload,
    })
    .returning();

  let lastError: string | null = null;
  let statusCode: number | null = null;

  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      const response = await request(channel.url, {
        method: 'POST',
        headers: headersFor(channel, event.type, body),
        body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      response.body.dump().catch(() => undefined);
      statusCode = response.statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        await db
          .update(webhookDeliveries)
          .set({ attempts: attempt, statusCode, error: null, deliveredAt: new Date() })
          .where(eq(webhookDeliveries.id, delivery!.id));
        return;
      }
      lastError = `Приёмник ответил ${statusCode}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await db
      .update(webhookDeliveries)
      .set({ attempts: attempt, statusCode, error: lastError })
      .where(eq(webhookDeliveries.id, delivery!.id));

    if (attempt < options.attempts) {
      await delay(options.retryDelayMs * attempt);
    }
  }
}

function headersFor(
  channel: ChannelRow,
  event: string,
  body: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-monitoring-event': event,
  };
  if (channel.secret) {
    const signature = crypto.createHmac('sha256', channel.secret).update(body).digest('hex');
    headers['x-monitoring-signature'] = `sha256=${signature}`;
  }
  return headers;
}

export function buildPayload(event: MonitoringEvent): Record<string, unknown> {
  const base = {
    event: event.type,
    at: new Date().toISOString(),
    check: {
      id: event.check.id,
      name: event.check.name,
      url: event.check.url,
      tags: event.check.tags,
    },
  };

  switch (event.type) {
    case 'incident.opened':
      return {
        ...base,
        incident: {
          id: event.incident.id,
          startedAt: event.incident.startedAt.toISOString(),
          errorKind: event.incident.firstErrorKind,
          error: event.incident.lastErrorMessage,
        },
      };

    case 'incident.resolved':
      return {
        ...base,
        incident: {
          id: event.incident.id,
          startedAt: event.incident.startedAt.toISOString(),
          resolvedAt: event.incident.resolvedAt?.toISOString() ?? null,
          durationMs: event.durationMs,
          failedResultsCount: event.incident.failedResultsCount,
        },
      };

    case 'cert.expiring':
      return {
        ...base,
        certificate: {
          daysRemaining: event.daysRemaining,
          validTo: event.validTo?.toISOString() ?? null,
        },
      };
  }
}
