import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { checkResults, checks, incidents, tlsCertificates } from '../db/schema.js';
import type { CheckRow } from '../checks/repository.js';
import type { ExecutionResult } from '../runner/executor.js';

export type IncidentRow = typeof incidents.$inferSelect;

export type MonitoringEvent =
  | { type: 'incident.opened'; check: CheckRow; incident: IncidentRow }
  | { type: 'incident.resolved'; check: CheckRow; incident: IncidentRow; durationMs: number }
  | {
      type: 'cert.expiring';
      check: CheckRow;
      daysRemaining: number;
      validTo: Date | null;
    };

/**
 * Записывает результат проверки и обновляет производные состояния: статус проверки,
 * инцидент и сертификат. Возвращает события, которые нужно разослать в каналы, —
 * сама отправка живёт в webhook.ts, чтобы запись в БД не зависела от внешней сети.
 */
export async function recordExecution(
  db: Database,
  check: CheckRow,
  result: ExecutionResult,
  options: { tlsWarnDays: number },
): Promise<MonitoringEvent[]> {
  const events: MonitoringEvent[] = [];

  await db.insert(checkResults).values({
    checkId: check.id,
    outcome: result.outcome,
    statusCode: result.statusCode,
    errorKind: result.errorKind,
    errorMessage: result.errorMessage,
    dnsMs: result.dnsMs,
    connectMs: result.connectMs,
    tlsMs: result.tlsMs,
    ttfbMs: result.ttfbMs,
    totalMs: result.totalMs,
    responseBytes: result.responseBytes,
    attempts: result.attempts,
    failedAssertion: result.failedAssertion,
  });

  const failed = result.outcome === 'fail';
  const consecutiveFailures = failed ? check.consecutiveFailures + 1 : 0;
  const status = nextStatus(check, result.outcome, consecutiveFailures);

  await db
    .update(checks)
    .set({
      currentStatus: status,
      consecutiveFailures,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(checks.id, check.id));

  const openIncident = await findOpenIncident(db, check.id);

  if (failed && status === 'down' && !openIncident) {
    const [incident] = await db
      .insert(incidents)
      .values({
        checkId: check.id,
        firstErrorKind: result.errorKind,
        lastErrorMessage: result.errorMessage,
        failedResultsCount: consecutiveFailures,
      })
      .returning();
    if (incident) events.push({ type: 'incident.opened', check, incident });
  } else if (failed && openIncident) {
    await db
      .update(incidents)
      .set({
        failedResultsCount: openIncident.failedResultsCount + 1,
        lastErrorMessage: result.errorMessage,
      })
      .where(eq(incidents.id, openIncident.id));
  } else if (!failed && openIncident) {
    const resolvedAt = new Date();
    const [incident] = await db
      .update(incidents)
      .set({ resolvedAt })
      .where(eq(incidents.id, openIncident.id))
      .returning();
    if (incident) {
      events.push({
        type: 'incident.resolved',
        check,
        incident,
        durationMs: resolvedAt.getTime() - incident.startedAt.getTime(),
      });
    }
  }

  if (result.certificate) {
    const certificateEvent = await saveCertificate(db, check, result.certificate, options.tlsWarnDays);
    if (certificateEvent) events.push(certificateEvent);
  }

  return events;
}

function nextStatus(
  check: CheckRow,
  outcome: ExecutionResult['outcome'],
  consecutiveFailures: number,
): CheckRow['currentStatus'] {
  if (outcome === 'ok') return 'up';
  if (outcome === 'degraded') return 'degraded';
  // Падение подтверждается несколькими неудачами подряд — одиночный сбой сети не должен
  // переводить проверку в down и будить дежурного.
  if (consecutiveFailures >= check.failureThreshold) return 'down';
  return check.currentStatus;
}

async function findOpenIncident(db: Database, checkId: string): Promise<IncidentRow | null> {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.checkId, checkId), isNull(incidents.resolvedAt)))
    .limit(1);
  return incident ?? null;
}

async function saveCertificate(
  db: Database,
  check: CheckRow,
  certificate: NonNullable<ExecutionResult['certificate']>,
  warnDays: number,
): Promise<MonitoringEvent | null> {
  const [previous] = await db
    .select()
    .from(tlsCertificates)
    .where(eq(tlsCertificates.checkId, check.id));

  const host = safeHost(check.url);
  await db
    .insert(tlsCertificates)
    .values({
      checkId: check.id,
      host,
      issuer: certificate.issuer,
      subject: certificate.subject,
      validFrom: certificate.validFrom,
      validTo: certificate.validTo,
      daysRemaining: certificate.daysRemaining,
      error: null,
      checkedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tlsCertificates.checkId,
      set: {
        host,
        issuer: certificate.issuer,
        subject: certificate.subject,
        validFrom: certificate.validFrom,
        validTo: certificate.validTo,
        daysRemaining: certificate.daysRemaining,
        error: null,
        checkedAt: new Date(),
      },
    });

  const daysRemaining = certificate.daysRemaining;
  if (daysRemaining === null || daysRemaining >= warnDays) return null;

  // Предупреждаем только на переходе через порог, иначе алерт повторялся бы каждую минуту.
  const alreadyWarned = previous?.daysRemaining !== null && (previous?.daysRemaining ?? Infinity) < warnDays;
  if (alreadyWarned) return null;

  return { type: 'cert.expiring', check, daysRemaining, validTo: certificate.validTo };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
