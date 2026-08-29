import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { connectTestDatabase, resetTables } from '../../tests/db.js';
import { startFixture, type Fixture } from '../../tests/httpFixture.js';
import { checkResults, checks } from '../db/schema.js';
import { createScheduler, mapConcurrent } from './scheduler.js';
import type { MonitoringEvent } from '../alerts/incidents.js';

const { pool, db } = connectTestDatabase();
let fixture: Fixture;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture.close();
  await pool.end();
});

beforeEach(async () => {
  await resetTables(db);
  logger.error.mockClear();
});

function makeScheduler(onEvents: (events: MonitoringEvent[]) => Promise<void> = async () => {}) {
  return createScheduler({
    db,
    options: {
      tickMs: 50,
      batchSize: 10,
      maxConcurrent: 4,
      maxResponseBytes: 65_536,
      tlsWarnDays: 14,
    },
    onEvents,
    logger,
  });
}

describe('createScheduler', () => {
  it('выполняет созревшие проверки и сохраняет результаты', async () => {
    await db.insert(checks).values([
      { name: 'ok', url: `${fixture.origin}/ok`, nextRunAt: new Date(Date.now() - 1000) },
      { name: 'fail', url: `${fixture.origin}/500`, nextRunAt: new Date(Date.now() - 1000) },
      { name: 'later', url: `${fixture.origin}/ok`, nextRunAt: new Date(Date.now() + 60_000) },
    ]);

    const executed = await makeScheduler().tick();

    expect(executed).toBe(2);
    const results = await db.select().from(checkResults);
    expect(results).toHaveLength(2);
    expect(results.map((row) => row.outcome).sort()).toEqual(['fail', 'ok']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('обновляет статус проверки по итогам прогона', async () => {
    const [check] = await db
      .insert(checks)
      .values({
        name: 'ok',
        url: `${fixture.origin}/ok`,
        nextRunAt: new Date(Date.now() - 1000),
        intervalSeconds: 30,
      })
      .returning();

    await makeScheduler().tick();

    const [updated] = await db.select().from(checks).where(eq(checks.id, check!.id));
    expect(updated?.currentStatus).toBe('up');
    expect(updated?.lastCheckedAt).not.toBeNull();
    expect(updated?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('отдаёт события наружу для рассылки', async () => {
    const received: MonitoringEvent[] = [];
    await db.insert(checks).values({
      name: 'fail',
      url: `${fixture.origin}/500`,
      failureThreshold: 1,
      nextRunAt: new Date(Date.now() - 1000),
    });

    await makeScheduler(async (events) => {
      received.push(...events);
    }).tick();

    expect(received.map((event) => event.type)).toEqual(['incident.opened']);
  });

  it('ничего не делает, когда нет созревших проверок', async () => {
    await db.insert(checks).values({
      name: 'later',
      url: `${fixture.origin}/ok`,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    expect(await makeScheduler().tick()).toBe(0);
    expect(await db.select().from(checkResults)).toHaveLength(0);
  });

  it('падение одной проверки не мешает остальным', async () => {
    await db.insert(checks).values([
      { name: 'broken', url: 'not-a-url', nextRunAt: new Date(Date.now() - 1000) },
      { name: 'ok', url: `${fixture.origin}/ok`, nextRunAt: new Date(Date.now() - 1000) },
    ]);

    await makeScheduler().tick();

    const results = await db.select().from(checkResults);
    expect(results).toHaveLength(2);
    expect(results.some((row) => row.errorKind === 'unknown')).toBe(true);
  });
});

describe('mapConcurrent', () => {
  it('не превышает заданный параллелизм', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);

    await mapConcurrent(items, 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it('обрабатывает каждый элемент ровно один раз', async () => {
    const seen: number[] = [];
    await mapConcurrent([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
