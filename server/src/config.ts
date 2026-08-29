import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL обязателен'),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  MAGIC_LINK_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  /** Сколько запросов ссылки в час допустимо с одного IP (на адрес лимит отдельный, 5). */
  AUTH_IP_RATE_LIMIT: z.coerce.number().int().positive().default(20),
  ADMIN_EMAIL: z.string().email().optional().or(z.literal('').transform(() => undefined)),

  SMTP_HOST: z.string().optional().or(z.literal('').transform(() => undefined)),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanish.default('false'),
  SMTP_USER: z.string().optional().or(z.literal('').transform(() => undefined)),
  SMTP_PASSWORD: z.string().optional().or(z.literal('').transform(() => undefined)),
  MAIL_FROM: z.string().default('monitoring@localhost'),

  SCHEDULER_ENABLED: booleanish.default('true'),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(5000),
  SCHEDULER_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  MAX_CONCURRENT_CHECKS: z.coerce.number().int().positive().default(20),
  MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(1_048_576),

  RAW_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  TLS_CHECK_INTERVAL_HOURS: z.coerce.number().int().positive().default(12),
  TLS_WARN_DAYS: z.coerce.number().int().positive().default(14),
});

export type Config = z.infer<typeof envSchema> & {
  isProduction: boolean;
  cookieSecure: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${details}`);
  }

  const env = parsed.data;
  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    cookieSecure: env.APP_BASE_URL.startsWith('https://'),
  };
}
