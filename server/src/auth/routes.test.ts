import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { APP_ORIGIN, createHarness, type Harness } from '../../tests/appHarness.js';
import { resetTables } from '../../tests/db.js';
import { loginTokens, users } from '../db/schema.js';

let harness: Harness;

beforeEach(async () => {
  harness ??= await createHarness();
  await resetTables(harness.db);
  harness.sent.length = 0;
});

afterAll(async () => {
  await harness?.close();
});

function tokenFrom(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

describe('POST /api/auth/magic-link', () => {
  it('отправляет ссылку заведённому пользователю', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test', role: 'viewer' });

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'ops@example.test' },
    });

    expect(response.statusCode).toBe(200);
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]!.link).toContain('/api/auth/callback?token=');
  });

  it('находит пользователя без учёта регистра', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test' });

    await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'OPS@example.TEST' },
    });

    expect(harness.sent).toHaveLength(1);
  });

  it('на неизвестный адрес отвечает так же, но письма не шлёт', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'stranger@example.test' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'sent' });
    expect(harness.sent).toHaveLength(0);
  });

  it('не пускает отключённого пользователя', async () => {
    await harness.db.insert(users).values({ email: 'left@example.test', isActive: false });

    await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'left@example.test' },
    });

    expect(harness.sent).toHaveLength(0);
  });

  it('отклоняет некорректный email', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'не-почта' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('ограничивает число запросов с одного IP', async () => {
    const limited = await createHarness({ AUTH_IP_RATE_LIMIT: '2' });
    try {
      await limited.db.insert(users).values({ email: 'ops@example.test' });
      const send = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/auth/magic-link',
          payload: { email: 'ops@example.test' },
        });

      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(200);
      expect((await send()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });

  it('перестаёт слать письма после шести запросов за час', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test' });

    for (let index = 0; index < 6; index += 1) {
      await harness.app.inject({
        method: 'POST',
        url: '/api/auth/magic-link',
        payload: { email: 'ops@example.test' },
      });
    }

    expect(harness.sent).toHaveLength(5);
  });
});

describe('GET /api/auth/callback', () => {
  it('обменивает токен на сессию и пускает в /me', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test', role: 'viewer' });
    await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'ops@example.test' },
    });

    const callback = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/callback?token=${tokenFrom(harness.sent[0]!.link)}`,
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe(`${APP_ORIGIN}/`);

    const cookie = callback.cookies.find((item) => item.name === 'monitoring_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite?.toLowerCase()).toBe('lax');

    const me = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${cookie.name}=${cookie.value}` },
    });

    expect(me.json()).toMatchObject({ email: 'ops@example.test', role: 'viewer' });
  });

  it('ссылка одноразовая', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test' });
    await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'ops@example.test' },
    });
    const token = tokenFrom(harness.sent[0]!.link);

    await harness.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` });
    const second = await harness.app.inject({ method: 'GET', url: `/api/auth/callback?token=${token}` });

    expect(second.headers.location).toBe(`${APP_ORIGIN}/login?error=link_used`);
  });

  it('истёкшая ссылка не пускает', async () => {
    await harness.db.insert(users).values({ email: 'ops@example.test' });
    await harness.app.inject({
      method: 'POST',
      url: '/api/auth/magic-link',
      payload: { email: 'ops@example.test' },
    });
    await harness.db.update(loginTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/auth/callback?token=${tokenFrom(harness.sent[0]!.link)}`,
    });

    expect(response.headers.location).toBe(`${APP_ORIGIN}/login?error=link_expired`);
  });

  it('подделанный токен не пускает', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/callback?token=поддельный',
    });

    expect(response.headers.location).toBe(`${APP_ORIGIN}/login?error=link_invalid`);
  });
});

describe('сессия', () => {
  it('/me без cookie возвращает 401', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('logout завершает сессию', async () => {
    const cookie = await harness.login('ops@example.test');

    await harness.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const me = await harness.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });

    expect(me.statusCode).toBe(401);
  });

  it('запрос с чужого Origin отклоняется', async () => {
    const cookie = await harness.login('ops@example.test');

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://evil.example' },
    });

    expect(response.statusCode).toBe(403);
  });
});
