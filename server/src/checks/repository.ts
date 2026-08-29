import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { checks } from '../db/schema.js';
import type { ExecutableCheck } from '../runner/executor.js';

export type CheckRow = typeof checks.$inferSelect;

/**
 * Забирает проверки, которым пора выполниться, и сразу сдвигает `next_run_at`.
 * `FOR UPDATE SKIP LOCKED` внутри одного оператора гарантирует, что второй инстанс
 * приложения не подхватит ту же проверку — очередь живёт в самом Postgres.
 */
export async function claimDueChecks(db: Database, limit: number): Promise<CheckRow[]> {
  const result = await db.execute(sql`
    WITH due AS (
      SELECT id FROM ${checks}
      WHERE enabled AND next_run_at <= now()
      ORDER BY next_run_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${checks} AS c
    SET next_run_at = now() + make_interval(secs => c.interval_seconds)
    FROM due
    WHERE c.id = due.id
    RETURNING c.*
  `);

  return (result.rows as Record<string, unknown>[]).map(mapRow);
}

export function toExecutable(check: CheckRow): ExecutableCheck {
  return {
    url: check.url,
    method: check.method,
    headers: check.headers,
    body: check.body,
    timeoutMs: check.timeoutMs,
    retries: check.retries,
    followRedirects: check.followRedirects,
    insecureSkipTlsVerify: check.insecureSkipTlsVerify,
    assertions: check.assertions,
    degradedThresholdMs: check.degradedThresholdMs,
  };
}

/** Drizzle возвращает snake_case из raw-запроса, приводим к форме модели. */
function mapRow(row: Record<string, unknown>): CheckRow {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    method: row.method as string,
    headers: (row.headers ?? {}) as Record<string, string>,
    body: (row.body ?? null) as string | null,
    intervalSeconds: row.interval_seconds as number,
    timeoutMs: row.timeout_ms as number,
    retries: row.retries as number,
    followRedirects: row.follow_redirects as boolean,
    insecureSkipTlsVerify: row.insecure_skip_tls_verify as boolean,
    assertions: (row.assertions ?? []) as CheckRow['assertions'],
    degradedThresholdMs: (row.degraded_threshold_ms ?? null) as number | null,
    failureThreshold: row.failure_threshold as number,
    tags: (row.tags ?? []) as string[],
    enabled: row.enabled as boolean,
    nextRunAt: toDate(row.next_run_at)!,
    currentStatus: row.current_status as CheckRow['currentStatus'],
    consecutiveFailures: row.consecutive_failures as number,
    lastCheckedAt: toDate(row.last_checked_at),
    createdAt: toDate(row.created_at)!,
    updatedAt: toDate(row.updated_at)!,
  };
}

/** В raw-запросах drizzle отдаёт timestamptz строкой — приводим к Date, как в select(). */
function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}
