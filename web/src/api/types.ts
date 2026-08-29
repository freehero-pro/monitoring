export type Role = 'admin' | 'viewer';

export type CurrentUser = { id: string; email: string; role: Role };

export type Assertion =
  | { type: 'status'; codes: number[] }
  | { type: 'status_range'; min: number; max: number }
  | { type: 'body_contains'; value: string; caseSensitive: boolean }
  | { type: 'body_not_contains'; value: string; caseSensitive: boolean }
  | {
      type: 'json_path';
      path: string;
      operator: 'equals' | 'not_equals' | 'contains' | 'exists';
      value?: string | number | boolean | null;
    }
  | { type: 'max_latency_ms'; value: number }
  | { type: 'header_equals'; name: string; value: string };

export type CheckSummary = {
  id: string;
  name: string;
  url: string;
  tags: string[];
  enabled: boolean;
  currentStatus: string;
  lastCheckedAt: string | null;
  intervalSeconds: number;
  total: number;
  uptime: number | null;
  p95Ms: number | null;
  avgMs: number | null;
  lastTotalMs: number | null;
  sparkline: number[];
  certificateDaysRemaining: number | null;
  openIncidentSince: string | null;
};

export type Check = {
  id: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  intervalSeconds: number;
  timeoutMs: number;
  retries: number;
  followRedirects: boolean;
  insecureSkipTlsVerify: boolean;
  assertions: Assertion[];
  degradedThresholdMs: number | null;
  failureThreshold: number;
  tags: string[];
  enabled: boolean;
  currentStatus: string;
  consecutiveFailures: number;
  lastCheckedAt: string | null;
  nextRunAt: string;
  channelIds: string[];
};

export type CheckResult = {
  id: number;
  checkId: string;
  checkedAt: string;
  outcome: 'ok' | 'degraded' | 'fail';
  statusCode: number | null;
  errorKind: string | null;
  errorMessage: string | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number;
  responseBytes: number | null;
  attempts: number;
  failedAssertion: { assertion: Assertion; message: string; actual: string | null } | null;
};

export type Incident = {
  id: string;
  checkId: string;
  checkName?: string;
  startedAt: string;
  resolvedAt: string | null;
  firstErrorKind: string | null;
  lastErrorMessage: string | null;
  failedResultsCount: number;
  durationMs?: number;
};

export type Certificate = {
  checkId: string;
  checkName?: string;
  host: string;
  issuer: string | null;
  subject: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  error: string | null;
  checkedAt: string;
};

export type SeriesPoint = {
  bucket: string;
  total: number;
  failCount: number;
  uptime: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
};

export type Channel = {
  id: string;
  type: string;
  name: string;
  url: string;
  secret: string | null;
  events: string[];
  enabled: boolean;
  createdAt: string;
};

export type Delivery = {
  id: number;
  channelId: string;
  event: string;
  attempts: number;
  statusCode: number | null;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
};
