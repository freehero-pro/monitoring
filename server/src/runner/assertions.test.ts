import { describe, expect, it } from 'vitest';
import { evaluateAssertions } from './assertions.js';
import type { Assertion } from '../checks/assertionSchema.js';

const response = {
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: '{"status":"ok","data":{"items":[{"id":7}]},"count":3,"healthy":true}',
  totalMs: 120,
};

function check(assertions: Assertion[], overrides: Partial<typeof response> = {}) {
  return evaluateAssertions(assertions, { ...response, ...overrides });
}

describe('evaluateAssertions', () => {
  it('пропускает ответ, когда все ассерты выполнены', () => {
    expect(
      check([
        { type: 'status', codes: [200, 204] },
        { type: 'body_contains', value: '"status":"ok"', caseSensitive: true },
        { type: 'max_latency_ms', value: 500 },
      ]),
    ).toBeNull();
  });

  it('возвращает первый упавший ассерт, а не последний', () => {
    const failure = check([
      { type: 'status', codes: [201] },
      { type: 'max_latency_ms', value: 1 },
    ]);
    expect(failure?.assertion.type).toBe('status');
    expect(failure?.actual).toBe('200');
  });

  describe('status', () => {
    it('падает, когда код не входит в список', () => {
      const failure = check([{ type: 'status', codes: [200] }], { statusCode: 503 });
      expect(failure?.message).toContain('503');
    });

    it('проверяет диапазон включительно', () => {
      expect(check([{ type: 'status_range', min: 200, max: 299 }], { statusCode: 299 })).toBeNull();
      expect(check([{ type: 'status_range', min: 200, max: 299 }], { statusCode: 300 })).not.toBeNull();
    });
  });

  describe('body', () => {
    it('по умолчанию сравнивает без учёта регистра', () => {
      expect(check([{ type: 'body_contains', value: '"STATUS"', caseSensitive: false }])).toBeNull();
      expect(
        check([{ type: 'body_contains', value: '"STATUS"', caseSensitive: true }]),
      ).not.toBeNull();
    });

    it('body_not_contains падает, когда подстрока найдена', () => {
      const failure = check([
        { type: 'body_not_contains', value: 'error', caseSensitive: false },
      ], { body: 'internal ERROR occurred' });
      expect(failure).not.toBeNull();
    });

    it('обрезает длинный actual, чтобы не раздувать запись в БД', () => {
      const failure = check([{ type: 'body_contains', value: 'нет-такой-строки', caseSensitive: false }], {
        body: 'x'.repeat(5000),
      });
      expect(failure?.actual?.length).toBeLessThanOrEqual(210);
    });
  });

  describe('json_path', () => {
    it('сравнивает значение по пути', () => {
      expect(check([{ type: 'json_path', path: '$.status', operator: 'equals', value: 'ok' }])).toBeNull();
      expect(
        check([{ type: 'json_path', path: '$.status', operator: 'equals', value: 'down' }]),
      ).not.toBeNull();
    });

    it('ходит по массивам и вложенным объектам', () => {
      expect(
        check([{ type: 'json_path', path: '$.data.items[0].id', operator: 'equals', value: 7 }]),
      ).toBeNull();
    });

    it('сравнивает числа и булевы значения по типу', () => {
      expect(check([{ type: 'json_path', path: '$.count', operator: 'equals', value: 3 }])).toBeNull();
      expect(check([{ type: 'json_path', path: '$.healthy', operator: 'equals', value: true }])).toBeNull();
      expect(
        check([{ type: 'json_path', path: '$.count', operator: 'equals', value: '3' }]),
      ).not.toBeNull();
    });

    it('поддерживает exists, contains и not_equals', () => {
      expect(check([{ type: 'json_path', path: '$.data', operator: 'exists' }])).toBeNull();
      expect(check([{ type: 'json_path', path: '$.missing', operator: 'exists' }])).not.toBeNull();
      expect(
        check([{ type: 'json_path', path: '$.status', operator: 'contains', value: 'o' }]),
      ).toBeNull();
      expect(
        check([{ type: 'json_path', path: '$.status', operator: 'not_equals', value: 'down' }]),
      ).toBeNull();
    });

    it('падает с понятным сообщением, если тело не JSON', () => {
      const failure = check([{ type: 'json_path', path: '$.status', operator: 'exists' }], {
        body: '<html>502 Bad Gateway</html>',
      });
      expect(failure?.message).toContain('JSON');
    });
  });

  describe('header_equals', () => {
    it('сравнивает имя заголовка без учёта регистра', () => {
      expect(
        check([{ type: 'header_equals', name: 'Content-Type', value: 'application/json' }]),
      ).toBeNull();
    });

    it('падает, когда заголовка нет', () => {
      const failure = check([{ type: 'header_equals', name: 'x-request-id', value: 'abc' }]);
      expect(failure?.actual).toBeNull();
    });
  });

  it('max_latency_ms сравнивает с фактическим временем ответа', () => {
    expect(check([{ type: 'max_latency_ms', value: 100 }], { totalMs: 101 })).not.toBeNull();
    expect(check([{ type: 'max_latency_ms', value: 100 }], { totalMs: 100 })).toBeNull();
  });
});
