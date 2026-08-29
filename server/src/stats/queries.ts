import { desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { checkResults, checks, incidents, tlsCertificates } from '../db/schema.js';

export const RANGES = {
  '24h': { hours: 24, bucketMinutes: 60 },
  '7d': { hours: 24 * 7, bucketMinutes: 60 },
  '30d': { hours: 24 * 30, bucketMinutes: 360 },
} as const;

export type RangeKey = keyof typeof RANGES;

export function parseRange(value: unknown): RangeKey {
  return value === '7d' || value === '30d' ? value : '24h';
}

export type CheckSummary = {
  id: string;
  name: string;
  url: string;
  tags: string[];
  enabled: boolean;
  currentStatus: string;
  lastCheckedAt: Date | null;
  intervalSeconds: number;
  total: number;
  uptime: number | null;
  p95Ms: number | null;
  avgMs: number | null;
  lastTotalMs: number | null;
  sparkline: number[];
  certificateDaysRemaining: number | null;
  openIncidentSince: Date | null;
};

/** Список проверок для главной: статус, uptime за сутки, p95 и спарклайн одним запросом. */
export async function listChecksWithStats(db: Database): Promise<CheckSummary[]> {
  const result = await db.execute(sql`
    SELECT
      c.id, c.name, c.url, c.tags, c.enabled, c.current_status, c.last_checked_at,
      c.interval_seconds,
      COALESCE(s.total, 0)::int AS total,
      s.uptime,
      s.p95_ms,
      s.avg_ms,
      spark.values AS sparkline,
      spark.last_total_ms,
      cert.days_remaining,
      inc.started_at AS open_incident_since
    FROM checks c
    LEFT JOIN LATERAL (
      SELECT
        count(*) AS total,
        (count(*) FILTER (WHERE outcome <> 'fail'))::float / NULLIF(count(*), 0) AS uptime,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms) AS p95_ms,
        avg(total_ms) AS avg_ms
      FROM check_results r
      WHERE r.check_id = c.id AND r.checked_at > now() - interval '24 hours'
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT
        array_agg(total_ms ORDER BY checked_at) AS values,
        (array_agg(total_ms ORDER BY checked_at DESC))[1] AS last_total_ms
      FROM (
        SELECT total_ms, checked_at FROM check_results
        WHERE check_id = c.id ORDER BY checked_at DESC LIMIT 30
      ) recent
    ) spark ON true
    LEFT JOIN tls_certificates cert ON cert.check_id = c.id
    LEFT JOIN LATERAL (
      SELECT started_at FROM incidents
      WHERE check_id = c.id AND resolved_at IS NULL
      ORDER BY started_at DESC LIMIT 1
    ) inc ON true
    ORDER BY c.name
  `);

  return (result.rows as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    tags: (row.tags ?? []) as string[],
    enabled: row.enabled as boolean,
    currentStatus: row.current_status as string,
    lastCheckedAt: toDate(row.last_checked_at),
    intervalSeconds: row.interval_seconds as number,
    total: row.total as number,
    uptime: toNumber(row.uptime),
    p95Ms: round(toNumber(row.p95_ms)),
    avgMs: round(toNumber(row.avg_ms)),
    lastTotalMs: toNumber(row.last_total_ms),
    sparkline: ((row.sparkline ?? []) as (number | null)[]).map((value) => value ?? 0),
    certificateDaysRemaining: toNumber(row.days_remaining),
    openIncidentSince: toDate(row.open_incident_since),
  }));
}

export type SeriesPoint = {
  bucket: string;
  total: number;
  failCount: number;
  uptime: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

/**
 * Ряды для графиков. За сутки считаем по сырым результатам (они точнее и всё равно
 * лежат под индексом), за неделю и месяц — по часовым агрегатам, чтобы не сканировать
 * десятки тысяч строк на каждый рендер.
 */
export async function timeSeries(
  db: Database,
  checkId: string,
  range: RangeKey,
): Promise<SeriesPoint[]> {
  const { hours, bucketMinutes } = RANGES[range];

  const result =
    range === '24h'
      ? await db.execute(sql`
          SELECT
            date_bin(make_interval(mins => ${bucketMinutes}), checked_at, timestamptz 'epoch') AS bucket,
            count(*)::int AS total,
            (count(*) FILTER (WHERE outcome = 'fail'))::int AS fail_count,
            (count(*) FILTER (WHERE outcome <> 'fail'))::float / NULLIF(count(*), 0) AS uptime,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms) AS p95_ms
          FROM check_results
          WHERE check_id = ${checkId} AND checked_at > now() - make_interval(hours => ${hours})
          GROUP BY bucket
          ORDER BY bucket
        `)
      : await db.execute(sql`
          SELECT
            date_bin(make_interval(mins => ${bucketMinutes}), bucket, timestamptz 'epoch') AS bucket,
            sum(total)::int AS total,
            sum(fail_count)::int AS fail_count,
            sum(total - fail_count)::float / NULLIF(sum(total), 0) AS uptime,
            sum(p50_ms * total) / NULLIF(sum(total), 0) AS p50_ms,
            max(p95_ms) AS p95_ms
          FROM check_stats_hourly
          WHERE check_id = ${checkId} AND bucket > now() - make_interval(hours => ${hours})
          GROUP BY 1
          ORDER BY 1
        `);

  return (result.rows as Record<string, unknown>[]).map((row) => ({
    bucket: new Date(String(row.bucket)).toISOString(),
    total: row.total as number,
    failCount: row.fail_count as number,
    uptime: toNumber(row.uptime),
    p50Ms: round(toNumber(row.p50_ms)),
    p95Ms: round(toNumber(row.p95_ms)),
  }));
}

export async function recentResults(db: Database, checkId: string, limit: number) {
  return db
    .select()
    .from(checkResults)
    .where(eq(checkResults.checkId, checkId))
    .orderBy(desc(checkResults.checkedAt))
    .limit(limit);
}

export async function incidentsForCheck(db: Database, checkId: string, limit = 50) {
  return db
    .select()
    .from(incidents)
    .where(eq(incidents.checkId, checkId))
    .orderBy(desc(incidents.startedAt))
    .limit(limit);
}

/** Инциденты по всем проверкам — для плашки на главной. */
export async function listIncidents(db: Database, options: { openOnly: boolean; limit?: number }) {
  const rows = await db
    .select({ incident: incidents, checkName: checks.name, checkId: checks.id })
    .from(incidents)
    .innerJoin(checks, eq(checks.id, incidents.checkId))
    .where(options.openOnly ? sql`${incidents.resolvedAt} IS NULL` : sql`true`)
    .orderBy(desc(incidents.startedAt))
    .limit(options.limit ?? 100);

  return rows.map((row) => ({
    ...row.incident,
    checkName: row.checkName,
    durationMs:
      (row.incident.resolvedAt ?? new Date()).getTime() - row.incident.startedAt.getTime(),
  }));
}

export async function listCertificates(db: Database) {
  const rows = await db
    .select({ certificate: tlsCertificates, checkName: checks.name })
    .from(tlsCertificates)
    .innerJoin(checks, eq(checks.id, tlsCertificates.checkId))
    .orderBy(tlsCertificates.daysRemaining);

  return rows.map((row) => ({ ...row.certificate, checkName: row.checkName }));
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}
