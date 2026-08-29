import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '../src/db/client.js';

export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ?? 'postgres://monitoring:monitoring@localhost:5432/monitoring_test'
  );
}

export function connectTestDatabase() {
  return createDatabase(testDatabaseUrl());
}

/** Между тестами таблицы чистятся, чтобы порядок тестов ни на что не влиял. */
export async function resetTables(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE users, login_tokens, sessions, checks, check_results, check_stats_hourly,
        tls_certificates, incidents, notification_channels, check_channels, webhook_deliveries
        RESTART IDENTITY CASCADE`,
  );
}
