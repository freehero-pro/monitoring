import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client.js';
import { createDatabase } from './client.js';
import { loadConfig } from '../config.js';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  const config = loadConfig();
  const { pool, db } = createDatabase(config.DATABASE_URL);
  try {
    await runMigrations(db);
    console.log('Миграции применены');
  } finally {
    await pool.end();
  }
}
