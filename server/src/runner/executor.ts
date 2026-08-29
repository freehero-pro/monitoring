import dns from 'node:dns/promises';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent, interceptors, request } from 'undici';
import type { Readable } from 'node:stream';
import type { Assertion, FailedAssertion } from '../checks/assertionSchema.js';
import { evaluateAssertions } from './assertions.js';
import { createTimedConnector, emptyTimings, type CertificateInfo } from './connector.js';

export type ErrorKind = 'dns' | 'connect' | 'tls' | 'timeout' | 'http' | 'assertion' | 'unknown';
export type Outcome = 'ok' | 'degraded' | 'fail';

export type ExecutableCheck = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  timeoutMs: number;
  retries: number;
  followRedirects: boolean;
  insecureSkipTlsVerify: boolean;
  assertions: Assertion[];
  degradedThresholdMs: number | null;
};

export type ExecutionResult = {
  outcome: Outcome;
  statusCode: number | null;
  errorKind: ErrorKind | null;
  errorMessage: string | null;
  dnsMs: number | null;
  connectMs: number | null;
  tlsMs: number | null;
  ttfbMs: number | null;
  totalMs: number;
  responseBytes: number | null;
  attempts: number;
  failedAssertion: FailedAssertion | null;
  certificate: CertificateInfo | null;
};

/** Если ассерты не заданы, успехом считается любой ответ ниже 400. */
const DEFAULT_ASSERTIONS: Assertion[] = [{ type: 'status_range', min: 100, max: 399 }];

const RETRY_DELAY_MS = 250;
const MAX_REDIRECTIONS = 5;

const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
]);

const TIMEOUT_ERROR_CODES = new Set([
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'ETIMEDOUT',
]);

const DNS_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);

const CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'EACCES',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_DESTROYED',
]);

export async function executeCheck(
  check: ExecutableCheck,
  options: { maxResponseBytes?: number } = {},
): Promise<ExecutionResult> {
  const maxResponseBytes = options.maxResponseBytes ?? 1_048_576;

  let attempts = 0;
  let result: ExecutionResult;
  for (;;) {
    attempts += 1;
    result = await attemptOnce(check, maxResponseBytes);
    if (result.outcome !== 'fail' || attempts > check.retries) break;
    await delay(RETRY_DELAY_MS);
  }

  return { ...result, attempts };
}

async function attemptOnce(
  check: ExecutableCheck,
  maxResponseBytes: number,
): Promise<ExecutionResult> {
  const startedAt = performance.now();
  const timings = emptyTimings();

  let url: URL;
  try {
    url = new URL(check.url);
  } catch {
    return failure({
      errorKind: 'unknown',
      errorMessage: `Некорректный URL: ${check.url}`,
      totalMs: 0,
      timings,
      dnsMs: null,
    });
  }

  // Резолвим отдельно, чтобы отличить «домен не существует» от «сервер не отвечает».
  let dnsMs: number | null = null;
  if (!net.isIP(url.hostname)) {
    const dnsStartedAt = performance.now();
    try {
      await dns.lookup(url.hostname);
      dnsMs = elapsed(dnsStartedAt);
    } catch (error) {
      return failure({
        errorKind: 'dns',
        errorMessage: describeError(error),
        totalMs: elapsed(startedAt),
        timings,
        dnsMs: elapsed(dnsStartedAt),
      });
    }
  }

  const agent = new Agent({
    connect: createTimedConnector(timings, {
      rejectUnauthorized: !check.insecureSkipTlsVerify,
      connectTimeoutMs: check.timeoutMs,
    }),
    connections: 1,
    pipelining: 0,
    headersTimeout: check.timeoutMs,
    bodyTimeout: check.timeoutMs,
  });

  const dispatcher = check.followRedirects
    ? agent.compose(interceptors.redirect({ maxRedirections: MAX_REDIRECTIONS }))
    : agent;

  try {
    const response = await request(check.url, {
      dispatcher,
      method: check.method as never,
      headers: check.headers,
      body: check.body ?? undefined,
      signal: AbortSignal.timeout(check.timeoutMs),
    });

    const ttfbMs = elapsed(startedAt);
    const { text, bytes } = await readLimited(response.body, maxResponseBytes);
    const totalMs = elapsed(startedAt);

    const assertions = check.assertions.length > 0 ? check.assertions : DEFAULT_ASSERTIONS;
    const failedAssertion = evaluateAssertions(assertions, {
      statusCode: response.statusCode,
      headers: response.headers as Record<string, string | string[] | undefined>,
      body: text,
      totalMs,
    });

    const degraded =
      check.degradedThresholdMs !== null && totalMs > check.degradedThresholdMs;

    return {
      outcome: failedAssertion ? 'fail' : degraded ? 'degraded' : 'ok',
      statusCode: response.statusCode,
      errorKind: failedAssertion ? kindOfAssertion(failedAssertion) : null,
      errorMessage: failedAssertion?.message ?? null,
      dnsMs,
      connectMs: timings.connectMs,
      tlsMs: timings.tlsMs,
      ttfbMs,
      totalMs,
      responseBytes: bytes,
      attempts: 1,
      failedAssertion,
      certificate: timings.certificate,
    };
  } catch (error) {
    return failure({
      errorKind: classifyError(error),
      errorMessage: describeError(error),
      totalMs: elapsed(startedAt),
      timings,
      dnsMs,
    });
  } finally {
    await agent.close().catch(() => agent.destroy());
  }
}

async function readLimited(
  body: Readable,
  maxBytes: number,
): Promise<{ text: string; bytes: number }> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of body) {
    const buffer = chunk as Buffer;
    bytes += buffer.byteLength;
    chunks.push(buffer);
    if (bytes >= maxBytes) {
      body.destroy();
      break;
    }
  }

  const buffer = Buffer.concat(chunks).subarray(0, maxBytes);
  return { text: buffer.toString('utf8'), bytes: Math.min(bytes, maxBytes) };
}

function kindOfAssertion(failed: FailedAssertion): ErrorKind {
  return failed.assertion.type === 'status' || failed.assertion.type === 'status_range'
    ? 'http'
    : 'assertion';
}

export function classifyError(error: unknown): ErrorKind {
  const codes = collectCodes(error);
  const name = error instanceof Error ? error.name : '';

  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  if (codes.some((code) => TIMEOUT_ERROR_CODES.has(code))) return 'timeout';
  if (codes.some((code) => TLS_ERROR_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL')))
    return 'tls';
  if (codes.some((code) => DNS_ERROR_CODES.has(code))) return 'dns';
  if (codes.some((code) => CONNECT_ERROR_CODES.has(code))) return 'connect';
  return 'unknown';
}

function collectCodes(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== 'object') return [];
  const codes: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') codes.push(code);
  codes.push(...collectCodes((error as { cause?: unknown }).cause, depth + 1));
  return codes;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : '';
  return `${error.message}${cause}`.slice(0, 500);
}

function failure(input: {
  errorKind: ErrorKind;
  errorMessage: string;
  totalMs: number;
  timings: ReturnType<typeof emptyTimings>;
  dnsMs: number | null;
}): ExecutionResult {
  return {
    outcome: 'fail',
    statusCode: null,
    errorKind: input.errorKind,
    errorMessage: input.errorMessage,
    dnsMs: input.dnsMs,
    connectMs: input.timings.connectMs,
    tlsMs: input.timings.tlsMs,
    ttfbMs: null,
    totalMs: input.totalMs,
    responseBytes: null,
    attempts: 1,
    failedAssertion: null,
    certificate: input.timings.certificate,
  };
}

function elapsed(from: number): number {
  return Math.round(performance.now() - from);
}
