import type { Database } from '../db/client.js';
import { claimDueChecks, toExecutable, type CheckRow } from '../checks/repository.js';
import { executeCheck, type ExecutionResult } from './executor.js';
import { recordExecution, type MonitoringEvent } from '../alerts/incidents.js';

export type RunnerOptions = {
  batchSize: number;
  maxConcurrent: number;
  maxResponseBytes: number;
  tlsWarnDays: number;
};

export type Logger = {
  info: (object: unknown, message?: string) => void;
  warn: (object: unknown, message?: string) => void;
  error: (object: unknown, message?: string) => void;
};

export type SchedulerDeps = {
  db: Database;
  options: RunnerOptions & { tickMs: number };
  onEvents: (events: MonitoringEvent[]) => Promise<void>;
  logger: Logger;
};

/**
 * Выполняет одну проверку и сохраняет её результат. Используется и планировщиком,
 * и ручным «проверить сейчас» из UI, поэтому логика записи одна на оба пути.
 */
export async function runCheck(
  db: Database,
  check: CheckRow,
  options: RunnerOptions,
): Promise<{ result: ExecutionResult; events: MonitoringEvent[] }> {
  const result = await executeCheck(toExecutable(check), {
    maxResponseBytes: options.maxResponseBytes,
  });
  const events = await recordExecution(db, check, result, { tlsWarnDays: options.tlsWarnDays });
  return { result, events };
}

export function createScheduler({ db, options, onEvents, logger }: SchedulerDeps) {
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;
  let stopped = false;

  /** Один проход: забрать созревшие проверки и выполнить их с ограничением параллелизма. */
  async function tick(): Promise<number> {
    const due = await claimDueChecks(db, options.batchSize);
    if (due.length === 0) return 0;

    const events: MonitoringEvent[] = [];
    await mapConcurrent(due, options.maxConcurrent, async (check) => {
      try {
        const outcome = await runCheck(db, check, options);
        events.push(...outcome.events);
      } catch (error) {
        logger.error({ err: error, checkId: check.id }, 'Проверка завершилась с ошибкой');
      }
    });

    if (events.length > 0) {
      try {
        await onEvents(events);
      } catch (error) {
        logger.error({ err: error }, 'Не удалось разослать события');
      }
    }

    return due.length;
  }

  async function safeTick(): Promise<void> {
    // Пропускаем тик, если предыдущий ещё идёт: иначе медленные проверки наслаиваются.
    if (ticking || stopped) return;
    ticking = true;
    try {
      await tick();
    } catch (error) {
      logger.error({ err: error }, 'Ошибка планировщика');
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => void safeTick(), options.tickMs);
      timer.unref();
      logger.info({ tickMs: options.tickMs }, 'Планировщик запущен');
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      while (ticking) await new Promise((resolve) => setTimeout(resolve, 25));
    },
  };
}

export async function mapConcurrent<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}
