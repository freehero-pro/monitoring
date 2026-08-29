import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { connectTestDatabase, resetTables } from '../../tests/db.js';
import { checkResults, checks, incidents, tlsCertificates } from '../db/schema.js';
import type { ExecutionResult } from '../runner/executor.js';
import { recordExecution } from './incidents.js';
import type { CheckRow } from '../checks/repository.js';

const { pool, db } = connectTestDatabase();

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetTables(db);
});

async function insertCheck(overrides: Partial<typeof checks.$inferInsert> = {}): Promise<CheckRow> {
  const [row] = await db
    .insert(checks)
    .values({ name: 'API', url: 'https://example.test/health', failureThreshold: 2, ...overrides })
    .returning();
  return row!;
}

function makeResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    outcome: 'ok',
    statusCode: 200,
    errorKind: null,
    errorMessage: null,
    dnsMs: 3,
    connectMs: 10,
    tlsMs: 20,
    ttfbMs: 40,
    totalMs: 50,
    responseBytes: 128,
    attempts: 1,
    failedAssertion: null,
    certificate: null,
    ...overrides,
  };
}

const failure = makeResult({
  outcome: 'fail',
  statusCode: 503,
  errorKind: 'http',
  errorMessage: 'Ожидался статус 200, получен 503',
});

async function reload(id: string): Promise<CheckRow> {
  const [row] = await db.select().from(checks).where(eq(checks.id, id));
  return row!;
}

describe('recordExecution', () => {
  it('сохраняет результат со всеми таймингами', async () => {
    const check = await insertCheck();
    await recordExecution(db, check, makeResult(), { tlsWarnDays: 14 });

    const [stored] = await db.select().from(checkResults).where(eq(checkResults.checkId, check.id));
    expect(stored?.outcome).toBe('ok');
    expect(stored?.statusCode).toBe(200);
    expect(stored?.dnsMs).toBe(3);
    expect(stored?.tlsMs).toBe(20);
    expect(stored?.totalMs).toBe(50);

    const updated = await reload(check.id);
    expect(updated.currentStatus).toBe('up');
    expect(updated.consecutiveFailures).toBe(0);
    expect(updated.lastCheckedAt).not.toBeNull();
  });

  it('одна неудача при пороге 2 не открывает инцидент', async () => {
    const check = await insertCheck();
    const events = await recordExecution(db, check, failure, { tlsWarnDays: 14 });

    expect(events).toHaveLength(0);
    const updated = await reload(check.id);
    expect(updated.consecutiveFailures).toBe(1);
    expect(updated.currentStatus).not.toBe('down');
    expect(await db.select().from(incidents)).toHaveLength(0);
  });

  it('вторая подряд неудача открывает инцидент и переводит проверку в down', async () => {
    let check = await insertCheck();
    await recordExecution(db, check, failure, { tlsWarnDays: 14 });
    check = await reload(check.id);
    const events = await recordExecution(db, check, failure, { tlsWarnDays: 14 });

    expect(events.map((event) => event.type)).toEqual(['incident.opened']);
    const updated = await reload(check.id);
    expect(updated.currentStatus).toBe('down');
    expect(updated.consecutiveFailures).toBe(2);

    const [incident] = await db.select().from(incidents);
    expect(incident?.resolvedAt).toBeNull();
    expect(incident?.firstErrorKind).toBe('http');
  });

  it('последующие неудачи не плодят инциденты, а копят статистику', async () => {
    let check = await insertCheck();
    for (let index = 0; index < 3; index += 1) {
      await recordExecution(db, check, failure, { tlsWarnDays: 14 });
      check = await reload(check.id);
    }

    const all = await db.select().from(incidents);
    expect(all).toHaveLength(1);
    // Две неудачи открыли инцидент, третья только увеличила счётчик.
    expect(all[0]?.failedResultsCount).toBe(3);
  });

  it('успех закрывает инцидент и сообщает о восстановлении', async () => {
    let check = await insertCheck();
    await recordExecution(db, check, failure, { tlsWarnDays: 14 });
    check = await reload(check.id);
    await recordExecution(db, check, failure, { tlsWarnDays: 14 });
    check = await reload(check.id);

    const events = await recordExecution(db, check, makeResult(), { tlsWarnDays: 14 });

    expect(events.map((event) => event.type)).toEqual(['incident.resolved']);
    const [incident] = await db.select().from(incidents);
    expect(incident?.resolvedAt).not.toBeNull();

    const updated = await reload(check.id);
    expect(updated.currentStatus).toBe('up');
    expect(updated.consecutiveFailures).toBe(0);
  });

  it('degraded не открывает инцидент, но виден в статусе', async () => {
    const check = await insertCheck();
    const events = await recordExecution(db, check, makeResult({ outcome: 'degraded' }), {
      tlsWarnDays: 14,
    });

    expect(events).toHaveLength(0);
    expect((await reload(check.id)).currentStatus).toBe('degraded');
  });

  it('сохраняет сертификат и предупреждает о скором истечении один раз', async () => {
    const check = await insertCheck();
    const certificate = {
      issuer: 'Test CA',
      subject: 'example.test',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validTo: new Date('2026-09-05T00:00:00Z'),
      daysRemaining: 7,
    };

    const first = await recordExecution(db, check, makeResult({ certificate }), { tlsWarnDays: 14 });
    expect(first.map((event) => event.type)).toEqual(['cert.expiring']);

    const [stored] = await db.select().from(tlsCertificates);
    expect(stored?.daysRemaining).toBe(7);
    expect(stored?.host).toBe('example.test');

    const second = await recordExecution(db, check, makeResult({ certificate }), { tlsWarnDays: 14 });
    expect(second).toHaveLength(0);
  });

  it('не предупреждает, пока до истечения сертификата далеко', async () => {
    const check = await insertCheck();
    const events = await recordExecution(
      db,
      check,
      makeResult({
        certificate: {
          issuer: 'Test CA',
          subject: 'example.test',
          validFrom: new Date('2026-01-01T00:00:00Z'),
          validTo: new Date('2027-01-01T00:00:00Z'),
          daysRemaining: 120,
        },
      }),
      { tlsWarnDays: 14 },
    );

    expect(events).toHaveLength(0);
    expect(await db.select().from(tlsCertificates)).toHaveLength(1);
  });
});
