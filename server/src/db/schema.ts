import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Assertion, FailedAssertion } from '../checks/assertionSchema.js';

export const userRole = pgEnum('user_role', ['admin', 'viewer']);
export const checkStatus = pgEnum('check_status', ['unknown', 'up', 'degraded', 'down']);
export const checkOutcome = pgEnum('check_outcome', ['ok', 'degraded', 'fail']);
export const errorKind = pgEnum('error_kind', [
  'dns',
  'connect',
  'tls',
  'timeout',
  'http',
  'assertion',
  'unknown',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    role: userRole('role').notNull().default('viewer'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [uniqueIndex('users_email_key').on(table.email)],
);

export const loginTokens = pgTable(
  'login_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestedIp: text('requested_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('login_tokens_hash_key').on(table.tokenHash)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (table) => [uniqueIndex('sessions_hash_key').on(table.tokenHash)],
);

export const checks = pgTable(
  'checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    method: text('method').notNull().default('GET'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    body: text('body'),
    intervalSeconds: integer('interval_seconds').notNull().default(60),
    timeoutMs: integer('timeout_ms').notNull().default(10_000),
    retries: integer('retries').notNull().default(1),
    followRedirects: boolean('follow_redirects').notNull().default(true),
    // Для внутренних сервисов с самоподписанным сертификатом.
    insecureSkipTlsVerify: boolean('insecure_skip_tls_verify').notNull().default(false),
    assertions: jsonb('assertions').$type<Assertion[]>().notNull().default([]),
    degradedThresholdMs: integer('degraded_threshold_ms'),
    failureThreshold: integer('failure_threshold').notNull().default(2),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull().defaultNow(),
    currentStatus: checkStatus('current_status').notNull().default('unknown'),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('checks_due_idx').on(table.enabled, table.nextRunAt)],
);

export const checkResults = pgTable(
  'check_results',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    checkId: uuid('check_id')
      .notNull()
      .references(() => checks.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: checkOutcome('outcome').notNull(),
    statusCode: integer('status_code'),
    errorKind: errorKind('error_kind'),
    errorMessage: text('error_message'),
    dnsMs: integer('dns_ms'),
    connectMs: integer('connect_ms'),
    tlsMs: integer('tls_ms'),
    ttfbMs: integer('ttfb_ms'),
    totalMs: integer('total_ms').notNull(),
    responseBytes: integer('response_bytes'),
    attempts: integer('attempts').notNull().default(1),
    failedAssertion: jsonb('failed_assertion').$type<FailedAssertion>(),
  },
  (table) => [index('check_results_check_time_idx').on(table.checkId, table.checkedAt.desc())],
);

export const checkStatsHourly = pgTable(
  'check_stats_hourly',
  {
    checkId: uuid('check_id')
      .notNull()
      .references(() => checks.id, { onDelete: 'cascade' }),
    bucket: timestamp('bucket', { withTimezone: true }).notNull(),
    total: integer('total').notNull(),
    okCount: integer('ok_count').notNull(),
    degradedCount: integer('degraded_count').notNull(),
    failCount: integer('fail_count').notNull(),
    p50Ms: real('p50_ms'),
    p95Ms: real('p95_ms'),
    avgMs: real('avg_ms'),
    maxMs: integer('max_ms'),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.bucket] })],
);

export const tlsCertificates = pgTable(
  'tls_certificates',
  {
    checkId: uuid('check_id')
      .primaryKey()
      .references(() => checks.id, { onDelete: 'cascade' }),
    host: text('host').notNull(),
    issuer: text('issuer'),
    subject: text('subject'),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    daysRemaining: integer('days_remaining'),
    error: text('error'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checkId: uuid('check_id')
      .notNull()
      .references(() => checks.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    firstErrorKind: errorKind('first_error_kind'),
    lastErrorMessage: text('last_error_message'),
    failedResultsCount: integer('failed_results_count').notNull().default(1),
  },
  (table) => [index('incidents_check_started_idx').on(table.checkId, table.startedAt.desc())],
);

export const notificationChannels = pgTable('notification_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull().default('webhook'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret'),
  events: jsonb('events').$type<string[]>().notNull().default(['incident.opened', 'incident.resolved']),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const checkChannels = pgTable(
  'check_channels',
  {
    checkId: uuid('check_id')
      .notNull()
      .references(() => checks.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.checkId, table.channelId] })],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => notificationChannels.id, { onDelete: 'cascade' }),
    incidentId: uuid('incident_id').references(() => incidents.id, { onDelete: 'set null' }),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    statusCode: integer('status_code'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  },
  (table) => [index('webhook_deliveries_created_idx').on(table.createdAt.desc())],
);
