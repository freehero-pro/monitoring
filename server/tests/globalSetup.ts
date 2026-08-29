import pg from 'pg';
import { createDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://monitoring:monitoring@localhost:5432/monitoring_test';

/**
 * Тесты идут против настоящего Postgres: они проверяют SKIP LOCKED, jsonb и агрегаты,
 * которые заглушкой не воспроизвести. База создаётся один раз на прогон.
 */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const databaseName = url.pathname.slice(1);
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';

  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `Не удалось подключиться к Postgres (${adminUrl.host}). Запустите \`docker compose up -d postgres\`.\n` +
        `Исходная ошибка: ${(error as Error).message}`,
    );
  }

  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (existing.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.end();

  const { pool, db } = createDatabase(TEST_DATABASE_URL);
  try {
    await runMigrations(db);
  } finally {
    await pool.end();
  }

  process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;
}
