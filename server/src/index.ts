import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { buildApp } from './app.js';
import { createScheduler } from './runner/scheduler.js';
import { dispatchEvents } from './alerts/webhook.js';
import { aggregateHourly } from './stats/aggregator.js';
import { purgeOldData } from './stats/retention.js';

const config = loadConfig();
const { pool, db } = createDatabase(config.DATABASE_URL);

await runMigrations(db);

const app = await buildApp({
  db,
  config,
  logger: config.isProduction
    ? true
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } },
});

const scheduler = createScheduler({
  db,
  options: {
    tickMs: config.SCHEDULER_TICK_MS,
    batchSize: config.SCHEDULER_BATCH_SIZE,
    maxConcurrent: config.MAX_CONCURRENT_CHECKS,
    maxResponseBytes: config.MAX_RESPONSE_BYTES,
    tlsWarnDays: config.TLS_WARN_DAYS,
  },
  onEvents: (events) => dispatchEvents(db, events),
  logger: app.log,
});

const maintenanceTimers: NodeJS.Timeout[] = [];

if (config.SCHEDULER_ENABLED) {
  scheduler.start();

  const aggregate = () =>
    aggregateHourly(db).catch((error) => app.log.error({ err: error }, 'Ошибка агрегации'));
  const purge = () =>
    purgeOldData(db, config.RAW_RETENTION_DAYS)
      .then((summary) => app.log.info(summary, 'Очистка истории выполнена'))
      .catch((error) => app.log.error({ err: error }, 'Ошибка очистки истории'));

  void aggregate();
  maintenanceTimers.push(setInterval(aggregate, 5 * 60_000));
  maintenanceTimers.push(setInterval(purge, 60 * 60_000));
  for (const timer of maintenanceTimers) timer.unref();
}

await app.listen({ port: config.PORT, host: config.HOST });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Останавливаемся');
  for (const timer of maintenanceTimers) clearInterval(timer);
  await scheduler.stop();
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
