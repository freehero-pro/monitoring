import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';
import { users } from './schema.js';

/**
 * Первый администратор заводится из ADMIN_EMAIL — иначе в свежую систему невозможно
 * войти: регистрации нет, пользователи добавляются вручную.
 */
async function seed(): Promise<void> {
  const config = loadConfig();
  if (!config.ADMIN_EMAIL) {
    console.error('Укажите ADMIN_EMAIL в .env, чтобы создать первого администратора');
    process.exitCode = 1;
    return;
  }

  const { pool, db } = createDatabase(config.DATABASE_URL);
  try {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${config.ADMIN_EMAIL})`);

    if (existing.length > 0) {
      console.log(`Пользователь ${config.ADMIN_EMAIL} уже существует`);
      return;
    }

    await db.insert(users).values({ email: config.ADMIN_EMAIL.toLowerCase(), role: 'admin' });
    console.log(`Создан администратор ${config.ADMIN_EMAIL}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seed();
}
