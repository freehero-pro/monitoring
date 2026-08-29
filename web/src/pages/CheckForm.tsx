import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Assertion, Channel, Check } from '../api/types';
import { AssertionEditor } from '../components/AssertionEditor';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Grid,
  Hint,
  Input,
  Label,
  PageHeader,
  Row,
  Select,
  Stack,
  TextArea,
  Title,
} from '../ui';

type FormState = {
  name: string;
  url: string;
  method: string;
  headersText: string;
  body: string;
  intervalSeconds: number;
  timeoutMs: number;
  retries: number;
  failureThreshold: number;
  degradedThresholdMs: string;
  followRedirects: boolean;
  insecureSkipTlsVerify: boolean;
  enabled: boolean;
  tagsText: string;
  assertions: Assertion[];
  channelIds: string[];
};

const EMPTY: FormState = {
  name: '',
  url: '',
  method: 'GET',
  headersText: '',
  body: '',
  intervalSeconds: 60,
  timeoutMs: 10_000,
  retries: 1,
  failureThreshold: 2,
  degradedThresholdMs: '',
  followRedirects: true,
  insecureSkipTlsVerify: false,
  enabled: true,
  tagsText: '',
  assertions: [],
  channelIds: [],
};

export function CheckFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const existing = useQuery({
    queryKey: ['check', id],
    queryFn: () => api.get<{ check: Check }>(`/api/checks/${id}`),
    enabled: isEdit,
  });

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ channels: Channel[] }>('/api/channels'),
  });

  useEffect(() => {
    const check = existing.data?.check;
    if (!check) return;
    setForm({
      name: check.name,
      url: check.url,
      method: check.method,
      headersText: Object.entries(check.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n'),
      body: check.body ?? '',
      intervalSeconds: check.intervalSeconds,
      timeoutMs: check.timeoutMs,
      retries: check.retries,
      failureThreshold: check.failureThreshold,
      degradedThresholdMs: check.degradedThresholdMs ? String(check.degradedThresholdMs) : '',
      followRedirects: check.followRedirects,
      insecureSkipTlsVerify: check.insecureSkipTlsVerify,
      enabled: check.enabled,
      tagsText: check.tags.join(', '),
      assertions: check.assertions,
      channelIds: check.channelIds,
    });
  }, [existing.data]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      isEdit
        ? api.patch<{ check: Check }>(`/api/checks/${id}`, payload)
        : api.post<{ check: Check }>('/api/checks', payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['checks'] });
      void queryClient.invalidateQueries({ queryKey: ['check', data.check.id] });
      navigate(`/checks/${data.check.id}`);
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : 'Не удалось сохранить проверку',
      ),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const headers = parseHeaders(form.headersText);
    if (headers === null) {
      setError('Заголовки задаются строками вида «Имя: значение»');
      return;
    }

    save.mutate({
      name: form.name.trim(),
      url: form.url.trim(),
      method: form.method,
      headers,
      body: form.body.trim() === '' ? null : form.body,
      intervalSeconds: form.intervalSeconds,
      timeoutMs: form.timeoutMs,
      retries: form.retries,
      failureThreshold: form.failureThreshold,
      degradedThresholdMs: form.degradedThresholdMs === '' ? null : Number(form.degradedThresholdMs),
      followRedirects: form.followRedirects,
      insecureSkipTlsVerify: form.insecureSkipTlsVerify,
      enabled: form.enabled,
      tags: form.tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      assertions: form.assertions,
      channelIds: form.channelIds,
    });
  }

  return (
    <form onSubmit={submit}>
      <PageHeader>
        <Title>{isEdit ? 'Изменить проверку' : 'Новая проверка'}</Title>
        <Row>
          <Button type="button" $variant="secondary" onClick={() => navigate(-1)}>
            Отмена
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </Row>
      </PageHeader>

      <Stack $gap={16}>
        <Card>
          <Field>
            <Label htmlFor="name">Название</Label>
            <Input id="name" value={form.name} required onChange={(event) => set('name', event.target.value)} />
          </Field>

          <Field>
            <Label htmlFor="url">Адрес</Label>
            <Row>
              <Select value={form.method} onChange={(event) => set('method', event.target.value)}>
                {['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </Select>
              <Input
                id="url"
                value={form.url}
                required
                placeholder="https://api.example.ru/health"
                onChange={(event) => set('url', event.target.value)}
              />
            </Row>
          </Field>

          <Field>
            <Label htmlFor="headers">Заголовки</Label>
            <TextArea
              id="headers"
              value={form.headersText}
              placeholder={'authorization: Bearer …\ncontent-type: application/json'}
              onChange={(event) => set('headersText', event.target.value)}
            />
            <Hint>По одному на строку, в формате «Имя: значение».</Hint>
          </Field>

          <Field>
            <Label htmlFor="body">Тело запроса</Label>
            <TextArea id="body" value={form.body} onChange={(event) => set('body', event.target.value)} />
          </Field>

          <Field>
            <Label htmlFor="tags">Теги</Label>
            <Input
              id="tags"
              value={form.tagsText}
              placeholder="prod, api"
              onChange={(event) => set('tagsText', event.target.value)}
            />
          </Field>
        </Card>

        <Card>
          <Label>Расписание и пороги</Label>
          <Grid $min="200px">
            <Field>
              <Label htmlFor="interval">Интервал, с</Label>
              <Input
                id="interval"
                type="number"
                min={10}
                value={form.intervalSeconds}
                onChange={(event) => set('intervalSeconds', Number(event.target.value))}
              />
            </Field>
            <Field>
              <Label htmlFor="timeout">Таймаут, мс</Label>
              <Input
                id="timeout"
                type="number"
                min={100}
                value={form.timeoutMs}
                onChange={(event) => set('timeoutMs', Number(event.target.value))}
              />
            </Field>
            <Field>
              <Label htmlFor="retries">Повторы при сбое</Label>
              <Input
                id="retries"
                type="number"
                min={0}
                max={5}
                value={form.retries}
                onChange={(event) => set('retries', Number(event.target.value))}
              />
            </Field>
            <Field>
              <Label htmlFor="threshold">Неудач до инцидента</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={10}
                value={form.failureThreshold}
                onChange={(event) => set('failureThreshold', Number(event.target.value))}
              />
            </Field>
            <Field>
              <Label htmlFor="degraded">Порог «медленно», мс</Label>
              <Input
                id="degraded"
                type="number"
                min={1}
                placeholder="не задан"
                value={form.degradedThresholdMs}
                onChange={(event) => set('degradedThresholdMs', event.target.value)}
              />
            </Field>
          </Grid>

          <Row $gap={18} $wrap>
            <label>
              <input
                type="checkbox"
                checked={form.followRedirects}
                onChange={(event) => set('followRedirects', event.target.checked)}
              />{' '}
              следовать редиректам
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.insecureSkipTlsVerify}
                onChange={(event) => set('insecureSkipTlsVerify', event.target.checked)}
              />{' '}
              не проверять TLS-сертификат
            </label>
            <label>
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => set('enabled', event.target.checked)}
              />{' '}
              проверка включена
            </label>
          </Row>
        </Card>

        <Card>
          <Label>Что считать корректным ответом</Label>
          <AssertionEditor value={form.assertions} onChange={(value) => set('assertions', value)} />
        </Card>

        <Card>
          <Label>Куда сообщать о падении</Label>
          {(channels.data?.channels.length ?? 0) === 0 ? (
            <Hint>Каналов пока нет. Добавьте webhook в разделе «Каналы».</Hint>
          ) : (
            <Stack $gap={6}>
              {channels.data!.channels.map((channel) => (
                <label key={channel.id}>
                  <input
                    type="checkbox"
                    checked={form.channelIds.includes(channel.id)}
                    onChange={(event) =>
                      set(
                        'channelIds',
                        event.target.checked
                          ? [...form.channelIds, channel.id]
                          : form.channelIds.filter((value) => value !== channel.id),
                      )
                    }
                  />{' '}
                  {channel.name} <Hint as="span">({channel.url})</Hint>
                </label>
              ))}
              <Hint>Если не выбрать ни одного, события получат каналы без привязок.</Hint>
            </Stack>
          )}
        </Card>

        {error && <ErrorText>{error}</ErrorText>}
      </Stack>
    </form>
  );
}

/** Возвращает null, если строку не удалось разобрать — так форма покажет понятную ошибку. */
function parseHeaders(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) return null;
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return headers;
}
