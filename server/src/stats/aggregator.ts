import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

/**
 * Сворачивает сырые результаты в часовые корзины. Пересчитывает несколько последних
 * часов целиком (а не только завершившийся), поэтому текущий час на графиках за 7 и 30
 * дней не проваливается в дыру, а запуск не обязан быть строго по расписанию.
 */
export async function aggregateHourly(db: Database, hoursBack = 3): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO check_stats_hourly (
      check_id, bucket, total, ok_count, degraded_count, fail_count, p50_ms, p95_ms, avg_ms, max_ms
    )
    SELECT
      check_id,
      date_trunc('hour', checked_at) AS bucket,
      count(*)::int,
      (count(*) FILTER (WHERE outcome = 'ok'))::int,
      (count(*) FILTER (WHERE outcome = 'degraded'))::int,
      (count(*) FILTER (WHERE outcome = 'fail'))::int,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms),
      percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms),
      avg(total_ms),
      max(total_ms)
    FROM check_results
    WHERE checked_at >= date_trunc('hour', now() - make_interval(hours => ${hoursBack}))
    GROUP BY check_id, bucket
    ON CONFLICT (check_id, bucket) DO UPDATE SET
      total = EXCLUDED.total,
      ok_count = EXCLUDED.ok_count,
      degraded_count = EXCLUDED.degraded_count,
      fail_count = EXCLUDED.fail_count,
      p50_ms = EXCLUDED.p50_ms,
      p95_ms = EXCLUDED.p95_ms,
      avg_ms = EXCLUDED.avg_ms,
      max_ms = EXCLUDED.max_ms
  `);

  return result.rowCount ?? 0;
}
