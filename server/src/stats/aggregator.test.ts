import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { connectTestDatabase, resetTables } from '../../tests/db.js';
import { checkResults, checkStatsHourly, checks, webhookDeliveries, notificationChannels } from '../db/schema.js';
import { aggregateHourly } from './aggregator.js';
import { purgeOldData } from './retention.js';
import { timeSeries } from './queries.js';

const { pool, db } = connectTestDatabase();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetTables(db);
});

async function insertCheck(): Promise<string> {
  const [row] = await db.insert(checks).values({ name: 'API', url: 'https://a.test' }).returning();
  return row!.id;
}

async function insertResults(
  checkId: string,
  items: { minutesAgo: number; totalMs: number; outcome: 'ok' | 'degraded' | 'fail' }[],
) {
  await db.insert(checkResults).values(
    items.map((item) => ({
      checkId,
      outcome: item.outcome,
      totalMs: item.totalMs,
      statusCode: item.outcome === 'fail' ? 500 : 200,
      checkedAt: new Date(Date.now() - item.minutesAgo * 60_000),
    })),
  );
}

describe('aggregateHourly', () => {
  it('сворачивает сырые результаты в часовые корзины', async () => {
    const checkId = await insertCheck();
    await insertResults(checkId, [
      { minutesAgo: 5, totalMs: 100, outcome: 'ok' },
      { minutesAgo: 6, totalMs: 300, outcome: 'ok' },
      { minutesAgo: 7, totalMs: 200, outcome: 'fail' },
    ]);

    await aggregateHourly(db, 3);

    const rows = await db.select().from(checkStatsHourly).where(eq(checkStatsHourly.checkId, checkId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 3, okCount: 2, failCount: 1, maxMs: 300 });
    expect(rows[0]!.p50Ms).toBe(200);
  });

  it('повторный запуск обновляет корзину, а не дублирует её', async () => {
    const checkId = await insertCheck();
    await insertResults(checkId, [{ minutesAgo: 5, totalMs: 100, outcome: 'ok' }]);
    await aggregateHourly(db, 3);

    await insertResults(checkId, [{ minutesAgo: 4, totalMs: 500, outcome: 'fail' }]);
    await aggregateHourly(db, 3);

    const rows = await db.select().from(checkStatsHourly);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total: 2, failCount: 1 });
  });

  it('графики за неделю строятся по агрегатам', async () => {
    const checkId = await insertCheck();
    await insertResults(checkId, [
      { minutesAgo: 10, totalMs: 120, outcome: 'ok' },
      { minutesAgo: 70, totalMs: 240, outcome: 'fail' },
    ]);
    await aggregateHourly(db, 3);

    const series = await timeSeries(db, checkId, '7d');

    expect(series).toHaveLength(2);
    expect(series.reduce((sum, point) => sum + point.total, 0)).toBe(2);
    expect(series.some((point) => point.failCount === 1)).toBe(true);
  });

  it('не трогает часы за пределами окна', async () => {
    const checkId = await insertCheck();
    await insertResults(checkId, [{ minutesAgo: 60 * 10, totalMs: 100, outcome: 'ok' }]);

    await aggregateHourly(db, 3);

    expect(await db.select().from(checkStatsHourly)).toHaveLength(0);
  });
});

describe('purgeOldData', () => {
  it('удаляет сырые результаты старше окна хранения и оставляет свежие', async () => {
    const checkId = await insertCheck();
    await db.insert(checkResults).values([
      { checkId, outcome: 'ok', totalMs: 100, checkedAt: new Date(Date.now() - 31 * 86_400_000) },
      { checkId, outcome: 'ok', totalMs: 100, checkedAt: new Date() },
    ]);

    const summary = await purgeOldData(db, 30);

    expect(summary.results).toBe(1);
    expect(await db.select().from(checkResults)).toHaveLength(1);
  });

  it('чистит журнал доставок webhook', async () => {
    const [channel] = await db
      .insert(notificationChannels)
      .values({ name: 'ops', url: 'https://hook.test' })
      .returning();
    await db.insert(webhookDeliveries).values({
      channelId: channel!.id,
      event: 'incident.opened',
      payload: {},
      createdAt: new Date(Date.now() - 40 * 86_400_000),
    });

    const summary = await purgeOldData(db, 30);

    expect(summary.deliveries).toBe(1);
  });

  it('часовые агрегаты переживают очистку сырых данных', async () => {
    const checkId = await insertCheck();
    await db.insert(checkStatsHourly).values({
      checkId,
      bucket: sql`date_trunc('hour', now() - interval '40 days')` as never,
      total: 10,
      okCount: 10,
      degradedCount: 0,
      failCount: 0,
    });

    await purgeOldData(db, 30);

    expect(await db.select().from(checkStatsHourly)).toHaveLength(1);
  });
});
