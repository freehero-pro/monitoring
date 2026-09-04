import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, type Config } from '../config.js';
import { createMailer } from './mailer.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeConfig(env: Record<string, string>): Config {
  return loadConfig({
    DATABASE_URL: 'postgres://localhost/test',
    ...env,
  } as NodeJS.ProcessEnv);
}

function mailer(env: Record<string, string>) {
  return createMailer(makeConfig(env), logger);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  logger.warn.mockClear();
  logger.error.mockClear();
});

const LINK = 'https://status.example.test/api/auth/callback?token=abc123';

describe('провайдер console', () => {
  it('печатает ссылку в лог и не ходит в сеть', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await mailer({ EMAIL_PROVIDER: 'console' }).sendMagicLink('user@example.test', LINK);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@example.test', link: LINK }),
      expect.stringContaining('лог'),
    );
  });

  it('используется по умолчанию, когда провайдер не задан', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await mailer({}).sendMagicLink('user@example.test', LINK);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('провайдер resend', () => {
  const env = {
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'monitoring@example.test',
    RESEND_API_KEY: 're_test_key',
  };

  it('отправляет письмо через REST API с ключом в заголовке', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await mailer(env).sendMagicLink('user@example.test', LINK);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');

    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('monitoring@example.test');
    expect(body.to).toEqual(['user@example.test']);
    expect(body.subject).toBeTruthy();
    expect(body.html).toContain(LINK);
    expect(body.text).toContain(LINK);
  });

  it('обрывает запрос по таймауту, а не висит бесконечно', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await mailer(env).sendMagicLink('user@example.test', LINK);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('на ответ не-2xx бросает исключение и логирует причину', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"message":"domain is not verified"}'),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await expect(
      mailer(env).sendMagicLink('user@example.test', LINK),
    ).rejects.toThrow(/письмо/i);
    expect(logger.error).toHaveBeenCalled();
  });

  it('сетевую ошибку тоже превращает в исключение', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(
      mailer(env).sendMagicLink('user@example.test', LINK),
    ).rejects.toThrow(/письмо/i);
    expect(logger.error).toHaveBeenCalled();
  });

  it('не пишет саму ссылку в лог: она даёт вход в систему', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('сеть недоступна')));

    await expect(mailer(env).sendMagicLink('user@example.test', LINK)).rejects.toThrow();

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain('abc123');
  });

  it('экранирует ссылку в html-атрибуте', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchSpy);
    const tricky = 'https://status.example.test/api/auth/callback?token=a"b&c';

    await mailer(env).sendMagicLink('user@example.test', tricky);

    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.html).toContain('href="https://status.example.test/api/auth/callback?token=a&quot;b&amp;c"');
  });
});

describe('конфигурация', () => {
  it('без ключа при provider=resend приложение не стартует', () => {
    expect(() => makeConfig({ EMAIL_PROVIDER: 'resend' })).toThrow(/RESEND_API_KEY/);
  });

  it('пустой ключ считается незаданным', () => {
    expect(() => makeConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '' })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('с ключом конфигурация валидна', () => {
    expect(makeConfig({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_x' }).EMAIL_PROVIDER).toBe(
      'resend',
    );
  });

  it('неизвестный провайдер отвергается', () => {
    expect(() => makeConfig({ EMAIL_PROVIDER: 'sendgrid' })).toThrow(/EMAIL_PROVIDER/);
  });
});
