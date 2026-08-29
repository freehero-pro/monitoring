import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

export type PurgeSummary = { results: number; deliveries: number; incidents: number };

/**
 * Сырые результаты живут ограниченное время — историю за пределами окна показывают
 * часовые агрегаты. Закрытые инциденты храним вдвое дольше: они занимают мало места
 * и нужны для разбора старых аварий.
 */
export async function purgeOldData(db: Database, rawRetentionDays: number): Promise<PurgeSummary> {
  const results = await db.execute(sql`
    DELETE FROM check_results
    WHERE checked_at < now() - make_interval(days => ${rawRetentionDays})
  `);

  const deliveries = await db.execute(sql`
    DELETE FROM webhook_deliveries
    WHERE created_at < now() - make_interval(days => ${rawRetentionDays})
  `);

  const incidents = await db.execute(sql`
    DELETE FROM incidents
    WHERE resolved_at IS NOT NULL
      AND resolved_at < now() - make_interval(days => ${rawRetentionDays * 2})
  `);

  return {
    results: results.rowCount ?? 0,
    deliveries: deliveries.rowCount ?? 0,
    incidents: incidents.rowCount ?? 0,
  };
}
