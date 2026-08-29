import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixture, type Fixture } from '../../tests/httpFixture.js';
import { executeCheck, type ExecutableCheck } from './executor.js';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture.close();
});

function makeCheck(overrides: Partial<ExecutableCheck> & { url: string }): ExecutableCheck {
  return {
    method: 'GET',
    headers: {},
    body: null,
    timeoutMs: 3000,
    retries: 0,
    followRedirects: true,
    insecureSkipTlsVerify: false,
    assertions: [],
    degradedThresholdMs: null,
    ...overrides,
  };
}

describe('executeCheck', () => {
  it('успешный ответ даёт outcome ok и разбивку по фазам', async () => {
    const result = await executeCheck(makeCheck({ url: `${fixture.origin}/ok` }));

    expect(result.outcome).toBe('ok');
    expect(result.statusCode).toBe(200);
    expect(result.errorKind).toBeNull();
    expect(result.dnsMs).toBeGreaterThanOrEqual(0);
    expect(result.connectMs).toBeGreaterThanOrEqual(0);
    expect(result.ttfbMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(result.ttfbMs!);
    expect(result.responseBytes).toBe(25);
    expect(result.attempts).toBe(1);
  });

  it('без ассертов считает успехом любой ответ ниже 400', async () => {
    const ok = await executeCheck(makeCheck({ url: `${fixture.origin}/ok` }));
    const failed = await executeCheck(makeCheck({ url: `${fixture.origin}/500` }));

    expect(ok.outcome).toBe('ok');
    expect(failed.outcome).toBe('fail');
    expect(failed.errorKind).toBe('http');
    expect(failed.statusCode).toBe(500);
  });

  it('упавший ассерт помечает результат как fail и сохраняет причину', async () => {
    const result = await executeCheck(
      makeCheck({
        url: `${fixture.origin}/ok`,
        assertions: [{ type: 'json_path', path: '$.status', operator: 'equals', value: 'down' }],
      }),
    );

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('assertion');
    expect(result.failedAssertion?.assertion.type).toBe('json_path');
    expect(result.errorMessage).toContain('$.status');
  });

  it('медленный, но корректный ответ помечается как degraded', async () => {
    const result = await executeCheck(
      makeCheck({ url: `${fixture.origin}/slow?ms=120`, degradedThresholdMs: 50 }),
    );

    expect(result.outcome).toBe('degraded');
    expect(result.statusCode).toBe(200);
    expect(result.errorKind).toBeNull();
  });

  it('таймаут классифицируется как timeout, а не как сетевая ошибка', async () => {
    const result = await executeCheck(
      makeCheck({ url: `${fixture.origin}/slow?ms=1000`, timeoutMs: 150 }),
    );

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('timeout');
    expect(result.totalMs).toBeLessThan(1000);
  });

  it('закрытый порт классифицируется как connect', async () => {
    const result = await executeCheck(makeCheck({ url: 'http://127.0.0.1:9/', timeoutMs: 2000 }));

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('connect');
  });

  it('нерезолвящийся домен классифицируется как dns', async () => {
    const result = await executeCheck(
      makeCheck({ url: 'http://this-host-does-not-exist.invalid/', timeoutMs: 2000 }),
    );

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('dns');
    expect(result.dnsMs).toBeGreaterThanOrEqual(0);
  });

  it('обрыв соединения классифицируется как connect', async () => {
    const result = await executeCheck(makeCheck({ url: `${fixture.origin}/reset` }));

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('connect');
  });

  it('следует за редиректом и умеет его не следовать', async () => {
    const followed = await executeCheck(makeCheck({ url: `${fixture.origin}/redirect` }));
    const notFollowed = await executeCheck(
      makeCheck({ url: `${fixture.origin}/redirect`, followRedirects: false }),
    );

    expect(followed.statusCode).toBe(200);
    expect(notFollowed.statusCode).toBe(302);
    expect(notFollowed.outcome).toBe('ok');
  });

  it('отправляет метод, заголовки и тело как задано', async () => {
    const result = await executeCheck(
      makeCheck({
        url: `${fixture.origin}/echo`,
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
        body: '{"ping":true}',
        assertions: [
          { type: 'json_path', path: '$.method', operator: 'equals', value: 'POST' },
          { type: 'json_path', path: '$.body', operator: 'equals', value: '{"ping":true}' },
          { type: 'json_path', path: '$.headers.authorization', operator: 'equals', value: 'Bearer secret' },
        ],
      }),
    );

    expect(result.failedAssertion).toBeNull();
    expect(result.outcome).toBe('ok');
  });

  it('не читает тело больше лимита', async () => {
    const result = await executeCheck(makeCheck({ url: `${fixture.origin}/big` }), {
      maxResponseBytes: 1024,
    });

    expect(result.outcome).toBe('ok');
    expect(result.responseBytes).toBeLessThanOrEqual(1024);
  });

  it('повторяет запрос после сбоя и сообщает число попыток', async () => {
    fixture.failFirst.set('/ok', 1);
    const result = await executeCheck(makeCheck({ url: `${fixture.origin}/ok`, retries: 2 }));

    expect(result.outcome).toBe('ok');
    expect(result.attempts).toBe(2);
  });

  it('исчерпав ретраи, возвращает последнюю ошибку', async () => {
    const result = await executeCheck(
      makeCheck({ url: 'http://127.0.0.1:9/', retries: 1, timeoutMs: 1000 }),
    );

    expect(result.outcome).toBe('fail');
    expect(result.attempts).toBe(2);
  });
});

describe('executeCheck по https', () => {
  let tlsFixture: Fixture;

  beforeAll(async () => {
    tlsFixture = await startFixture({ tls: true });
  });

  afterAll(async () => {
    await tlsFixture.close();
  });

  it('самоподписанный сертификат даёт ошибку tls', async () => {
    const result = await executeCheck(makeCheck({ url: `${tlsFixture.origin}/ok` }));

    expect(result.outcome).toBe('fail');
    expect(result.errorKind).toBe('tls');
  });

  it('с insecureSkipTlsVerify проходит, измеряет handshake и читает сертификат', async () => {
    const result = await executeCheck(
      makeCheck({ url: `${tlsFixture.origin}/ok`, insecureSkipTlsVerify: true }),
    );

    expect(result.outcome).toBe('ok');
    expect(result.tlsMs).toBeGreaterThanOrEqual(0);
    expect(result.certificate?.validTo).toBeInstanceOf(Date);
    expect(result.certificate?.daysRemaining).toBeLessThanOrEqual(2);
  });
});
