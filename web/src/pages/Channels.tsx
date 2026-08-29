import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { Channel, Delivery } from '../api/types';
import { formatDateTime } from '../format';
import {
  Button,
  Card,
  Empty,
  ErrorText,
  Field,
  Hint,
  Input,
  Label,
  Mono,
  PageHeader,
  Row,
  Stack,
  Table,
  Title,
} from '../ui';

const ALL_EVENTS = ['incident.opened', 'incident.resolved', 'cert.expiring'] as const;

const EVENT_LABELS: Record<string, string> = {
  'incident.opened': 'падение',
  'incident.resolved': 'восстановление',
  'cert.expiring': 'истекает сертификат',
};

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ channels: Channel[]; deliveries: Delivery[] }>('/api/channels'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['channels'] });

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/channels', {
        name: name.trim(),
        url: url.trim(),
        secret: secret.trim() === '' ? null : secret.trim(),
      }),
    onSuccess: () => {
      setName('');
      setUrl('');
      setSecret('');
      setError(null);
      void invalidate();
    },
    onError: (mutationError) =>
      setError(mutationError instanceof ApiError ? mutationError.message : 'Не удалось создать канал'),
  });

  const toggle = useMutation({
    mutationFn: (channel: Channel) => api.patch(`/api/channels/${channel.id}`, { enabled: !channel.enabled }),
    onSuccess: () => void invalidate(),
  });

  const remove = useMutation({
    mutationFn: (channel: Channel) => api.delete(`/api/channels/${channel.id}`),
    onSuccess: () => void invalidate(),
  });

  const test = useMutation({
    mutationFn: (channel: Channel) => api.post(`/api/channels/${channel.id}/test`),
    onSuccess: () => void invalidate(),
  });

  return (
    <Stack $gap={16}>
      <PageHeader>
        <div>
          <Title>Каналы уведомлений</Title>
          <Hint>
            При падении и восстановлении проверки шлём POST с JSON. Если задан секрет, добавляем
            подпись в заголовке <Mono>X-Monitoring-Signature</Mono>.
          </Hint>
        </div>
      </PageHeader>

      <Card>
        <Label>Новый webhook</Label>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Row $gap={10} $wrap style={{ alignItems: 'flex-end' }}>
            <Field style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <Label htmlFor="channel-name">Название</Label>
              <Input id="channel-name" value={name} required onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field style={{ flex: '2 1 320px', marginBottom: 0 }}>
              <Label htmlFor="channel-url">URL приёмника</Label>
              <Input
                id="channel-url"
                value={url}
                required
                placeholder="https://hooks.example.ru/monitoring"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <Field style={{ flex: '1 1 180px', marginBottom: 0 }}>
              <Label htmlFor="channel-secret">Секрет подписи</Label>
              <Input id="channel-secret" value={secret} onChange={(event) => setSecret(event.target.value)} />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              Добавить
            </Button>
          </Row>
        </form>
        {error && <ErrorText>{error}</ErrorText>}
      </Card>

      <Card>
        {(channels.data?.channels.length ?? 0) === 0 ? (
          <Empty>Каналов пока нет</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Название</th>
                <th>URL</th>
                <th>События</th>
                <th>Состояние</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {channels.data!.channels.map((channel) => (
                <tr key={channel.id}>
                  <td>{channel.name}</td>
                  <td>
                    <Mono>{channel.url}</Mono>
                  </td>
                  <td>
                    {channel.events
                      .map((event) => EVENT_LABELS[event] ?? event)
                      .join(', ')}
                  </td>
                  <td>{channel.enabled ? 'включён' : 'выключен'}</td>
                  <td>
                    <Row $gap={6}>
                      <Button
                        type="button"
                        $variant="secondary"
                        onClick={() => test.mutate(channel)}
                        disabled={test.isPending}
                      >
                        Тест
                      </Button>
                      <Button type="button" $variant="secondary" onClick={() => toggle.mutate(channel)}>
                        {channel.enabled ? 'Выключить' : 'Включить'}
                      </Button>
                      <Button
                        type="button"
                        $variant="danger"
                        onClick={() => {
                          if (confirm(`Удалить канал «${channel.name}»?`)) remove.mutate(channel);
                        }}
                      >
                        Удалить
                      </Button>
                    </Row>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <Label>Последние доставки</Label>
        {(channels.data?.deliveries.length ?? 0) === 0 ? (
          <Empty>Отправок ещё не было</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Событие</th>
                <th>Попыток</th>
                <th>Код</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {channels.data!.deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{formatDateTime(delivery.createdAt)}</td>
                  <td>{EVENT_LABELS[delivery.event] ?? delivery.event}</td>
                  <td>{delivery.attempts}</td>
                  <td>{delivery.statusCode ?? '—'}</td>
                  <td>{delivery.deliveredAt ? 'доставлено' : (delivery.error ?? 'не доставлено')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Hint>
          Доступные события: {ALL_EVENTS.map((event) => EVENT_LABELS[event]).join(', ')}.
        </Hint>
      </Card>
    </Stack>
  );
}
