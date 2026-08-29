import http from 'node:http';
import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, resetTables } from '../../tests/db.js';
import { checkChannels, checks, incidents, notificationChannels, webhookDeliveries } from '../db/schema.js';
import { dispatchEvents } from './webhook.js';
import type { MonitoringEvent } from './incidents.js';
import type { CheckRow } from '../checks/repository.js';

const { pool, db } = connectTestDatabase();

type Received = { path: string; headers: http.IncomingHttpHeaders; body: string };

let server: http.Server;
let origin: string;
let received: Received[] = [];
let responder: (path: string, attempt: number) => number = () => 200;
const attemptsByPath = new Map<string, number>();

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const path = req.url ?? '/';
    const attempt = (attemptsByPath.get(path) ?? 0) + 1;
    attemptsByPath.set(path, attempt);
    received.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
    res.writeHead(responder(path, attempt));
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('нет порта');
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

beforeEach(async () => {
  await resetTables(db);
  received = [];
  attemptsByPath.clear();
});

afterEach(() => {
  responder = () => 200;
});

async function insertCheck(): Promise<CheckRow> {
  const [row] = await db.insert(checks).values({ name: 'API', url: 'https://example.test' }).returning();
  return row!;
}

async function insertChannel(path: string, overrides: Partial<typeof notificationChannels.$inferInsert> = {}) {
  const [row] = await db
    .insert(notificationChannels)
    .values({ name: 'ops', url: `${origin}${path}`, secret: 'topsecret', ...overrides })
    .returning();
  return row!;
}

async function openedEvent(check: CheckRow): Promise<MonitoringEvent> {
  const [incident] = await db
    .insert(incidents)
    .values({ checkId: check.id, firstErrorKind: 'http', lastErrorMessage: '503' })
    .returning();
  return { type: 'incident.opened', check, incident: incident! };
}

const fastRetries = { attempts: 3, retryDelayMs: 5, timeoutMs: 2000 };

describe('dispatchEvents', () => {
  it('шлёт событие в связанный канал с подписью', async () => {
    const check = await insertCheck();
    const channel = await insertChannel('/hook');
    await db.insert(checkChannels).values({ checkId: check.id, channelId: channel.id });

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received).toHaveLength(1);
    const delivery = received[0]!;
    const payload = JSON.parse(delivery.body);
    expect(payload.event).toBe('incident.opened');
    expect(payload.check.name).toBe('API');
    expect(payload.incident.id).toBeTruthy();

    const expected = crypto.createHmac('sha256', 'topsecret').update(delivery.body).digest('hex');
    expect(delivery.headers['x-monitoring-signature']).toBe(`sha256=${expected}`);
    expect(delivery.headers['x-monitoring-event']).toBe('incident.opened');
  });

  it('канал без привязок получает события всех проверок', async () => {
    const check = await insertCheck();
    await insertChannel('/global');

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received.map((item) => item.path)).toEqual(['/global']);
  });

  it('канал, привязанный к другой проверке, событие не получает', async () => {
    const check = await insertCheck();
    const [other] = await db
      .insert(checks)
      .values({ name: 'Другой', url: 'https://other.test' })
      .returning();
    const channel = await insertChannel('/hook');
    await db.insert(checkChannels).values({ checkId: other!.id, channelId: channel.id });

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received).toHaveLength(0);
  });

  it('уважает подписку канала на конкретные события', async () => {
    const check = await insertCheck();
    await insertChannel('/only-resolved', { events: ['incident.resolved'] });

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received).toHaveLength(0);
  });

  it('выключенный канал пропускается', async () => {
    const check = await insertCheck();
    await insertChannel('/off', { enabled: false });

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received).toHaveLength(0);
  });

  it('повторяет доставку после ошибки и фиксирует успех', async () => {
    const check = await insertCheck();
    await insertChannel('/flaky');
    responder = (_path, attempt) => (attempt === 1 ? 500 : 200);

    await dispatchEvents(db, [await openedEvent(check)], fastRetries);

    expect(received).toHaveLength(2);
    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery?.attempts).toBe(2);
    expect(delivery?.statusCode).toBe(200);
    expect(delivery?.deliveredAt).not.toBeNull();
  });

  it('исчерпав попытки, сохраняет ошибку и не бросает исключение', async () => {
    const check = await insertCheck();
    await insertChannel('/down');
    responder = () => 503;

    await expect(dispatchEvents(db, [await openedEvent(check)], fastRetries)).resolves.toBeUndefined();

    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery?.attempts).toBe(3);
    expect(delivery?.deliveredAt).toBeNull();
    expect(delivery?.error).toContain('503');
  });

  it('недоступный хост не роняет рассылку', async () => {
    const check = await insertCheck();
    await db
      .insert(notificationChannels)
      .values({ name: 'мертвый', url: 'http://127.0.0.1:9/hook' });

    await expect(
      dispatchEvents(db, [await openedEvent(check)], { attempts: 1, retryDelayMs: 1, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();

    const [delivery] = await db.select().from(webhookDeliveries);
    expect(delivery?.deliveredAt).toBeNull();
    expect(delivery?.error).toBeTruthy();
  });
});
