import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, resetTables } from '../../tests/db.js';
import { checks } from '../db/schema.js';
import { claimDueChecks } from './repository.js';

const { pool, db } = connectTestDatabase();
const second = connectTestDatabase();

afterAll(async () => {
  await pool.end();
  await second.pool.end();
});

beforeEach(async () => {
  await resetTables(db);
});

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 60_000);

describe('claimDueChecks', () => {
  it('берёт только включённые проверки, которым пора', async () => {
    await db.insert(checks).values([
      { name: 'due', url: 'https://a.test', nextRunAt: past() },
      { name: 'later', url: 'https://b.test', nextRunAt: future() },
      { name: 'disabled', url: 'https://c.test', nextRunAt: past(), enabled: false },
    ]);

    const claimed = await claimDueChecks(db, 10);

    expect(claimed.map((check) => check.name)).toEqual(['due']);
  });

  it('сдвигает next_run_at на интервал, поэтому повторный вызов ничего не берёт', async () => {
    await db
      .insert(checks)
      .values({ name: 'due', url: 'https://a.test', nextRunAt: past(), intervalSeconds: 300 });

    const first = await claimDueChecks(db, 10);
    const second = await claimDueChecks(db, 10);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(first[0]!.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 250_000);
  });

  it('соблюдает лимит выборки', async () => {
    await db.insert(checks).values(
      Array.from({ length: 5 }, (_, index) => ({
        name: `check-${index}`,
        url: `https://${index}.test`,
        nextRunAt: past(),
      })),
    );

    expect(await claimDueChecks(db, 2)).toHaveLength(2);
    expect(await claimDueChecks(db, 10)).toHaveLength(3);
  });

  it('два инстанса не забирают одну и ту же проверку', async () => {
    await db.insert(checks).values(
      Array.from({ length: 20 }, (_, index) => ({
        name: `check-${index}`,
        url: `https://${index}.test`,
        nextRunAt: past(),
      })),
    );

    const [left, right] = await Promise.all([
      claimDueChecks(db, 20),
      claimDueChecks(second.db, 20),
    ]);

    const ids = [...left, ...right].map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(20);
  });

  it('возвращает поля проверки в пригодном для раннера виде', async () => {
    await db.insert(checks).values({
      name: 'api',
      url: 'https://a.test',
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: '{"a":1}',
      assertions: [{ type: 'status', codes: [200] }],
      tags: ['prod', 'api'],
      nextRunAt: past(),
    });

    const [claimed] = await claimDueChecks(db, 1);

    expect(claimed?.headers).toEqual({ authorization: 'Bearer x' });
    expect(claimed?.assertions).toEqual([{ type: 'status', codes: [200] }]);
    expect(claimed?.tags).toEqual(['prod', 'api']);
    expect(claimed?.body).toBe('{"a":1}');
  });
});
