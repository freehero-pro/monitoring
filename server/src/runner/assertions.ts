import type { Assertion, FailedAssertion } from '../checks/assertionSchema.js';

export type ResponseSnapshot = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  totalMs: number;
};

const MAX_ACTUAL_LENGTH = 200;

/**
 * Прогоняет ассерты по порядку и возвращает первый упавший — именно он попадает в
 * `check_results.failed_assertion`, чтобы в UI было видно точную причину падения.
 */
export function evaluateAssertions(
  assertions: Assertion[],
  response: ResponseSnapshot,
): FailedAssertion | null {
  for (const assertion of assertions) {
    const failure = evaluate(assertion, response);
    if (failure) return failure;
  }
  return null;
}

function evaluate(assertion: Assertion, response: ResponseSnapshot): FailedAssertion | null {
  switch (assertion.type) {
    case 'status': {
      if (assertion.codes.includes(response.statusCode)) return null;
      return fail(
        assertion,
        `Ожидался статус ${assertion.codes.join(', ')}, получен ${response.statusCode}`,
        String(response.statusCode),
      );
    }

    case 'status_range': {
      if (response.statusCode >= assertion.min && response.statusCode <= assertion.max) return null;
      return fail(
        assertion,
        `Ожидался статус в диапазоне ${assertion.min}–${assertion.max}, получен ${response.statusCode}`,
        String(response.statusCode),
      );
    }

    case 'body_contains': {
      if (contains(response.body, assertion.value, assertion.caseSensitive)) return null;
      return fail(assertion, `В теле ответа не найдено «${assertion.value}»`, truncate(response.body));
    }

    case 'body_not_contains': {
      if (!contains(response.body, assertion.value, assertion.caseSensitive)) return null;
      return fail(assertion, `В теле ответа найдено запрещённое «${assertion.value}»`, truncate(response.body));
    }

    case 'max_latency_ms': {
      if (response.totalMs <= assertion.value) return null;
      return fail(
        assertion,
        `Ответ за ${response.totalMs} мс превысил лимит ${assertion.value} мс`,
        String(response.totalMs),
      );
    }

    case 'header_equals': {
      const actual = findHeader(response.headers, assertion.name);
      if (actual === assertion.value) return null;
      return fail(
        assertion,
        `Заголовок ${assertion.name}: ожидалось «${assertion.value}», получено «${actual ?? 'отсутствует'}»`,
        actual,
      );
    }

    case 'json_path':
      return evaluateJsonPath(assertion, response);
  }
}

function evaluateJsonPath(
  assertion: Extract<Assertion, { type: 'json_path' }>,
  response: ResponseSnapshot,
): FailedAssertion | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return fail(assertion, 'Тело ответа не является валидным JSON', truncate(response.body));
  }

  const actual = readJsonPath(parsed, assertion.path);
  const actualText = actual === undefined ? null : truncate(JSON.stringify(actual) ?? String(actual));

  switch (assertion.operator) {
    case 'exists':
      return actual === undefined
        ? fail(assertion, `По пути ${assertion.path} значения нет`, actualText)
        : null;

    case 'equals':
      return actual === assertion.value
        ? null
        : fail(
            assertion,
            `По пути ${assertion.path} ожидалось ${JSON.stringify(assertion.value)}, получено ${actualText ?? 'отсутствует'}`,
            actualText,
          );

    case 'not_equals':
      return actual !== assertion.value
        ? null
        : fail(assertion, `По пути ${assertion.path} значение совпало с запрещённым`, actualText);

    case 'contains': {
      const haystack = typeof actual === 'string' ? actual : JSON.stringify(actual ?? null);
      const needle = String(assertion.value ?? '');
      return haystack.includes(needle)
        ? null
        : fail(assertion, `По пути ${assertion.path} не найдено «${needle}»`, actualText);
    }
  }
}

/** Минимальный JSON-path: `$.a.b[0].c`, `a.b` — без фильтров и wildcard-ов. */
export function readJsonPath(source: unknown, path: string): unknown {
  const segments = path
    .replace(/^\$\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);

  let current: unknown = source;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function contains(haystack: string, needle: string, caseSensitive: boolean): boolean {
  return caseSensitive
    ? haystack.includes(needle)
    : haystack.toLowerCase().includes(needle.toLowerCase());
}

function findHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target) continue;
    if (value === undefined) return null;
    return Array.isArray(value) ? value.join(', ') : value;
  }
  return null;
}

function truncate(value: string): string {
  return value.length > MAX_ACTUAL_LENGTH ? `${value.slice(0, MAX_ACTUAL_LENGTH)}…` : value;
}

function fail(assertion: Assertion, message: string, actual: string | null): FailedAssertion {
  return { assertion, message, actual };
}
