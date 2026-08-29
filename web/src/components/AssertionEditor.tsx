import styled from 'styled-components';
import type { Assertion } from '../api/types';
import { Button, Hint, Input, Row, Select, Stack } from '../ui';

const Item = styled.div`
  display: grid;
  grid-template-columns: 190px 1fr auto;
  gap: 8px;
  align-items: center;
`;

const TYPE_LABELS: Record<Assertion['type'], string> = {
  status: 'Код ответа из списка',
  status_range: 'Код ответа в диапазоне',
  body_contains: 'Тело содержит',
  body_not_contains: 'Тело не содержит',
  json_path: 'JSON-поле',
  max_latency_ms: 'Ответ быстрее, мс',
  header_equals: 'Заголовок равен',
};

function emptyAssertion(type: Assertion['type']): Assertion {
  switch (type) {
    case 'status':
      return { type: 'status', codes: [200] };
    case 'status_range':
      return { type: 'status_range', min: 200, max: 299 };
    case 'body_contains':
      return { type: 'body_contains', value: '', caseSensitive: false };
    case 'body_not_contains':
      return { type: 'body_not_contains', value: '', caseSensitive: false };
    case 'json_path':
      return { type: 'json_path', path: '$.status', operator: 'equals', value: 'ok' };
    case 'max_latency_ms':
      return { type: 'max_latency_ms', value: 1000 };
    case 'header_equals':
      return { type: 'header_equals', name: 'content-type', value: 'application/json' };
  }
}

type Props = {
  value: Assertion[];
  onChange: (value: Assertion[]) => void;
};

/**
 * Редактор ассертов. Если список пуст, сервер считает успехом любой ответ ниже 400 —
 * об этом прямо сказано в подсказке, чтобы пустая форма не выглядела недонастроенной.
 */
export function AssertionEditor({ value, onChange }: Props) {
  const update = (index: number, next: Assertion) =>
    onChange(value.map((item, position) => (position === index ? next : item)));

  return (
    <Stack $gap={8}>
      {value.length === 0 && (
        <Hint>Без ассертов успехом считается любой ответ с кодом ниже 400.</Hint>
      )}

      {value.map((assertion, index) => (
        <Item key={index}>
          <Select
            value={assertion.type}
            onChange={(event) => update(index, emptyAssertion(event.target.value as Assertion['type']))}
          >
            {Object.entries(TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </Select>

          <div>{renderFields(assertion, (next) => update(index, next))}</div>

          <Button
            type="button"
            $variant="secondary"
            onClick={() => onChange(value.filter((_, position) => position !== index))}
          >
            Убрать
          </Button>
        </Item>
      ))}

      <div>
        <Button type="button" $variant="secondary" onClick={() => onChange([...value, emptyAssertion('status')])}>
          Добавить условие
        </Button>
      </div>
    </Stack>
  );
}

function renderFields(assertion: Assertion, onChange: (next: Assertion) => void) {
  switch (assertion.type) {
    case 'status':
      return (
        <Input
          value={assertion.codes.join(', ')}
          placeholder="200, 204"
          onChange={(event) =>
            onChange({
              type: 'status',
              codes: event.target.value
                .split(',')
                .map((part) => Number(part.trim()))
                .filter((code) => Number.isInteger(code) && code >= 100 && code <= 599),
            })
          }
        />
      );

    case 'status_range':
      return (
        <Row>
          <Input
            type="number"
            value={assertion.min}
            onChange={(event) => onChange({ ...assertion, min: Number(event.target.value) })}
          />
          <Input
            type="number"
            value={assertion.max}
            onChange={(event) => onChange({ ...assertion, max: Number(event.target.value) })}
          />
        </Row>
      );

    case 'body_contains':
    case 'body_not_contains':
      return (
        <Row>
          <Input
            value={assertion.value}
            placeholder="подстрока"
            onChange={(event) => onChange({ ...assertion, value: event.target.value })}
          />
          <label style={{ whiteSpace: 'nowrap', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={assertion.caseSensitive}
              onChange={(event) => onChange({ ...assertion, caseSensitive: event.target.checked })}
            />{' '}
            регистр важен
          </label>
        </Row>
      );

    case 'json_path':
      return (
        <Row>
          <Input
            value={assertion.path}
            placeholder="$.status"
            onChange={(event) => onChange({ ...assertion, path: event.target.value })}
          />
          <Select
            value={assertion.operator}
            onChange={(event) =>
              onChange({ ...assertion, operator: event.target.value as typeof assertion.operator })
            }
          >
            <option value="equals">равно</option>
            <option value="not_equals">не равно</option>
            <option value="contains">содержит</option>
            <option value="exists">существует</option>
          </Select>
          {assertion.operator !== 'exists' && (
            <Input
              value={String(assertion.value ?? '')}
              placeholder="ok"
              onChange={(event) => onChange({ ...assertion, value: parseValue(event.target.value) })}
            />
          )}
        </Row>
      );

    case 'max_latency_ms':
      return (
        <Input
          type="number"
          value={assertion.value}
          onChange={(event) => onChange({ ...assertion, value: Number(event.target.value) })}
        />
      );

    case 'header_equals':
      return (
        <Row>
          <Input
            value={assertion.name}
            placeholder="content-type"
            onChange={(event) => onChange({ ...assertion, name: event.target.value })}
          />
          <Input
            value={assertion.value}
            placeholder="application/json"
            onChange={(event) => onChange({ ...assertion, value: event.target.value })}
          />
        </Row>
      );
  }
}

/** «3» должно сравниваться как число, «true» — как булево: иначе ассерт не сойдётся. */
function parseValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}
