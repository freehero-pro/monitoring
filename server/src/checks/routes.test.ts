import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../../tests/appHarness.js';
import { resetTables } from '../../tests/db.js';
import { startFixture, type Fixture } from '../../tests/httpFixture.js';
import { checkChannels, checkResults } from '../db/schema.js';

let harness: Harness;
let fixture: Fixture;
let admin: string;
let viewer: string;

beforeAll(async () => {
  harness = await createHarness();
  fixture = await startFixture();
});

afterAll(async () => {
  await fixture.close();
  await harness.close();
});

beforeEach(async () => {
  await resetTables(harness.db);
  harness.sent.length = 0;
  admin = await harness.login('admin@example.test', 'admin');
  viewer = await harness.login('viewer@example.test', 'viewer');
});

function payload(overrides: Record<string, unknown> = {}) {
  return { name: 'Health API', url: `${fixture.origin}/ok`, ...overrides };
}

async function createCheck(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await harness.app.inject({
    method: 'POST',
    url: '/api/checks',
    headers: { cookie: admin },
    payload: payload(overrides),
  });
  expect(response.statusCode).toBe(201);
  return response.json().check.id;
}

describe('доступ к /api/checks', () => {
  it('без входа возвращает 401', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/api/checks' });
    expect(response.statusCode).toBe(401);
  });

  it('viewer читает список, но не может создавать', async () => {
    await createCheck();

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/checks',
      headers: { cookie: viewer },
    });
    const create = await harness.app.inject({
      method: 'POST',
      url: '/api/checks',
      headers: { cookie: viewer },
      payload: payload({ name: 'Ещё одна' }),
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().checks).toHaveLength(1);
    expect(create.statusCode).toBe(403);
  });

  it('viewer не может удалять и запускать проверки', async () => {
    const id = await createCheck();

    const remove = await harness.app.inject({
      method: 'DELETE',
      url: `/api/checks/${id}`,
      headers: { cookie: viewer },
    });
    const run = await harness.app.inject({
      method: 'POST',
      url: `/api/checks/${id}/run`,
      headers: { cookie: viewer },
    });

    expect(remove.statusCode).toBe(403);
    expect(run.statusCode).toBe(403);
  });
});

describe('CRUD проверок', () => {
  it('создаёт проверку с ассертами и ставит её в очередь', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/checks',
      headers: { cookie: admin },
      payload: payload({
        method: 'POST',
        body: '{"ping":1}',
        headers: { 'content-type': 'application/json' },
        assertions: [{ type: 'status', codes: [200] }],
        tags: ['prod'],
        intervalSeconds: 120,
      }),
    });

    const created = response.json().check;
    expect(created.currentStatus).toBe('unknown');
    expect(created.assertions).toEqual([{ type: 'status', codes: [200] }]);
    expect(created.tags).toEqual(['prod']);
    expect(new Date(created.nextRunAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('отклоняет некорректные данные', async () => {
    const badUrl = await harness.app.inject({
      method: 'POST',
      url: '/api/checks',
      headers: { cookie: admin },
      payload: { name: 'Плохой', url: 'ftp://example.test' },
    });
    const badInterval = await harness.app.inject({
      method: 'POST',
      url: '/api/checks',
      headers: { cookie: admin },
      payload: payload({ intervalSeconds: 1 }),
    });

    expect(badUrl.statusCode).toBe(400);
    expect(badInterval.statusCode).toBe(400);
  });

  it('обновляет и удаляет проверку', async () => {
    const id = await createCheck();

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/api/checks/${id}`,
      headers: { cookie: admin },
      payload: { name: 'Переименовали', enabled: false },
    });
    expect(patched.json().check).toMatchObject({ name: 'Переименовали', enabled: false });

    const deleted = await harness.app.inject({
      method: 'DELETE',
      url: `/api/checks/${id}`,
      headers: { cookie: admin },
    });
    const again = await harness.app.inject({
      method: 'DELETE',
      url: `/api/checks/${id}`,
      headers: { cookie: admin },
    });

    expect(deleted.statusCode).toBe(204);
    expect(again.statusCode).toBe(404);
  });

  it('несуществующая проверка отдаёт 404', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/checks/11111111-1111-1111-1111-111111111111',
      headers: { cookie: admin },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('запуск и статистика', () => {
  it('«проверить сейчас» выполняет запрос и пишет результат в историю', async () => {
    const id = await createCheck();

    const run = await harness.app.inject({
      method: 'POST',
      url: `/api/checks/${id}/run`,
      headers: { cookie: admin },
    });

    expect(run.json().result).toMatchObject({ outcome: 'ok', statusCode: 200 });
    expect(await harness.db.select().from(checkResults)).toHaveLength(1);

    const detail = await harness.app.inject({
      method: 'GET',
      url: `/api/checks/${id}`,
      headers: { cookie: viewer },
    });
    expect(detail.json().check.currentStatus).toBe('up');
    expect(detail.json().lastResults).toHaveLength(1);
  });

  it('список отдаёт uptime и спарклайн по накопленным результатам', async () => {
    const id = await createCheck();
    await harness.app.inject({
      method: 'POST',
      url: `/api/checks/${id}/run`,
      headers: { cookie: admin },
    });

    const list = await harness.app.inject({
      method: 'GET',
      url: '/api/checks',
      headers: { cookie: admin },
    });

    const [summary] = list.json().checks;
    expect(summary.total).toBe(1);
    expect(summary.uptime).toBe(1);
    expect(summary.sparkline).toHaveLength(1);
    expect(summary.p95Ms).toBeGreaterThanOrEqual(0);
  });

  it('ряд для графика строится по сырым результатам за сутки', async () => {
    const id = await createCheck();
    await harness.app.inject({
      method: 'POST',
      url: `/api/checks/${id}/run`,
      headers: { cookie: admin },
    });

    const stats = await harness.app.inject({
      method: 'GET',
      url: `/api/checks/${id}/stats?range=24h`,
      headers: { cookie: admin },
    });

    const body = stats.json();
    expect(body.range).toBe('24h');
    expect(body.series).toHaveLength(1);
    expect(body.series[0]).toMatchObject({ total: 1, failCount: 0, uptime: 1 });
  });

  it('падение проверки видно в инцидентах', async () => {
    const id = await createCheck({ url: `${fixture.origin}/500`, failureThreshold: 1 });
    await harness.app.inject({
      method: 'POST',
      url: `/api/checks/${id}/run`,
      headers: { cookie: admin },
    });

    const incidents = await harness.app.inject({
      method: 'GET',
      url: '/api/incidents?open=true',
      headers: { cookie: viewer },
    });

    expect(incidents.json().incidents).toHaveLength(1);
    expect(incidents.json().incidents[0]).toMatchObject({ checkName: 'Health API' });
  });
});

describe('каналы уведомлений', () => {
  it('доступны только администратору', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/channels',
      headers: { cookie: viewer },
    });
    expect(response.statusCode).toBe(403);
  });

  it('создаётся и привязывается к проверке', async () => {
    const channel = await harness.app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { cookie: admin },
      payload: { name: 'Дежурные', url: `${fixture.origin}/echo`, secret: 'shh' },
    });
    expect(channel.statusCode).toBe(201);
    const channelId = channel.json().channel.id;

    const checkId = await createCheck({ channelIds: [channelId] });

    const links = await harness.db.select().from(checkChannels);
    expect(links).toEqual([{ checkId, channelId }]);
  });

  it('тестовая отправка доходит до приёмника', async () => {
    const channel = await harness.app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: { cookie: admin },
      payload: { name: 'Дежурные', url: `${fixture.origin}/echo`, secret: 'shh' },
    });
    const channelId = channel.json().channel.id;

    const test = await harness.app.inject({
      method: 'POST',
      url: `/api/channels/${channelId}/test`,
      headers: { cookie: admin },
    });

    expect(test.json().delivery).toMatchObject({ statusCode: 200, event: 'incident.opened' });
    expect(test.json().delivery.deliveredAt).not.toBeNull();
  });
});
