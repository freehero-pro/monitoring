import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import styled from 'styled-components';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Certificate, Check, CheckResult, Incident, SeriesPoint } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { LatencyChart } from '../components/LatencyChart';
import { UptimeBar } from '../components/UptimeBar';
import { PhaseBreakdown } from '../components/PhaseBreakdown';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { ERROR_KIND_LABELS, formatAgo, formatDateTime, formatDuration, formatMs, formatUptime } from '../format';
import {
  Button,
  Card,
  Empty,
  Grid,
  Mono,
  PageHeader,
  Row,
  Select,
  Stack,
  Subtitle,
  Table,
  Tag,
  Title,
} from '../ui';
import { statusColor } from '../theme';

type Detail = {
  check: Check;
  certificate: Certificate | null;
  lastResults: CheckResult[];
  incidents: Incident[];
};

const SectionTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
`;

const Outcome = styled.span<{ $outcome: string }>`
  font-weight: 600;
  color: ${({ $outcome, theme }) =>
    $outcome === 'ok' ? theme.colors.up : $outcome === 'degraded' ? theme.colors.degraded : theme.colors.down};
`;

const OUTCOME_LABELS: Record<string, string> = {
  ok: 'успех',
  degraded: 'медленно',
  fail: 'ошибка',
};

export function CheckDetailPage() {
  const { id = '' } = useParams();
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');

  const detail = useQuery({
    queryKey: ['check', id],
    queryFn: () => api.get<Detail>(`/api/checks/${id}`),
    refetchInterval: 30_000,
  });

  const stats = useQuery({
    queryKey: ['check', id, 'stats', range],
    queryFn: () => api.get<{ series: SeriesPoint[] }>(`/api/checks/${id}/stats?range=${range}`),
    refetchInterval: 60_000,
  });

  const runNow = useMutation({
    mutationFn: () => api.post<{ result: CheckResult }>(`/api/checks/${id}/run`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['check', id] });
      void queryClient.invalidateQueries({ queryKey: ['checks'] });
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/api/checks/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['checks'] });
      navigate('/');
    },
  });

  if (detail.isLoading) return <Empty>Загружаем…</Empty>;
  if (!detail.data) return <Empty>Проверка не найдена</Empty>;

  const { check, certificate, lastResults, incidents } = detail.data;
  const series = stats.data?.series ?? [];
  const uptime = series.length
    ? series.reduce((sum, point) => sum + (point.total - point.failCount), 0) /
      Math.max(1, series.reduce((sum, point) => sum + point.total, 0))
    : null;
  const latest = lastResults[0];

  return (
    <Stack $gap={16}>
      <PageHeader>
        <div>
          <Row $gap={10}>
            <Title>{check.name}</Title>
            <StatusBadge status={check.currentStatus} />
          </Row>
          <Subtitle>
            <Mono>
              {check.method} {check.url}
            </Mono>
          </Subtitle>
          <Subtitle>
            Интервал {check.intervalSeconds} с · проверена {formatAgo(check.lastCheckedAt)}
          </Subtitle>
        </div>
        <Row>
          <Select value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
            <option value="24h">24 часа</option>
            <option value="7d">7 дней</option>
            <option value="30d">30 дней</option>
          </Select>
          {user?.role === 'admin' && (
            <>
              <Button $variant="secondary" onClick={() => runNow.mutate()} disabled={runNow.isPending}>
                {runNow.isPending ? 'Проверяем…' : 'Проверить сейчас'}
              </Button>
              <Button as={Link} to={`/checks/${id}/edit`} $variant="secondary">
                Изменить
              </Button>
              <Button
                $variant="danger"
                onClick={() => {
                  if (confirm(`Удалить проверку «${check.name}»? История будет потеряна.`)) {
                    remove.mutate();
                  }
                }}
              >
                Удалить
              </Button>
            </>
          )}
        </Row>
      </PageHeader>

      <Grid $min="240px">
        <Card>
          <SectionTitle>Доступность за период</SectionTitle>
          <div style={{ fontSize: 24, fontWeight: 650 }}>{formatUptime(uptime)}</div>
        </Card>
        <Card>
          <SectionTitle>p95 за период</SectionTitle>
          <div style={{ fontSize: 24, fontWeight: 650 }}>
            {formatMs(
              series.length
                ? Math.max(...series.map((point) => point.p95Ms ?? 0))
                : null,
            )}
          </div>
        </Card>
        <Card>
          <SectionTitle>Сертификат</SectionTitle>
          {certificate?.daysRemaining !== undefined && certificate?.daysRemaining !== null ? (
            <div>
              <div style={{ fontSize: 24, fontWeight: 650 }}>{certificate.daysRemaining} дн.</div>
              <Subtitle>
                {certificate.issuer ?? '—'} · до {formatDateTime(certificate.validTo)}
              </Subtitle>
            </div>
          ) : (
            <Empty>Нет данных (нужен https)</Empty>
          )}
        </Card>
      </Grid>

      <Card>
        <SectionTitle>Время ответа</SectionTitle>
        {series.length === 0 ? <Empty>Пока нет данных за период</Empty> : <LatencyChart series={series} />}
      </Card>

      <Card>
        <SectionTitle>Доступность по времени</SectionTitle>
        {series.length === 0 ? <Empty>Пока нет данных за период</Empty> : <UptimeBar series={series} />}
      </Card>

      {latest && (
        <Card>
          <SectionTitle>Из чего сложился последний ответ</SectionTitle>
          <PhaseBreakdown result={latest} />
        </Card>
      )}

      <Card>
        <SectionTitle>Последние проверки</SectionTitle>
        {lastResults.length === 0 ? (
          <Empty>Проверка ещё не выполнялась</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Итог</th>
                <th>Код</th>
                <th>Время ответа</th>
                <th>Проблема</th>
              </tr>
            </thead>
            <tbody>
              {lastResults.map((result) => (
                <tr key={result.id}>
                  <td>{formatDateTime(result.checkedAt)}</td>
                  <td>
                    <Outcome $outcome={result.outcome}>{OUTCOME_LABELS[result.outcome]}</Outcome>
                  </td>
                  <td>{result.statusCode ?? '—'}</td>
                  <td>{formatMs(result.totalMs)}</td>
                  <td>
                    {result.errorMessage ? (
                      <>
                        <Tag>{ERROR_KIND_LABELS[result.errorKind ?? 'unknown']}</Tag>{' '}
                        {result.errorMessage}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <SectionTitle>Инциденты</SectionTitle>
        {incidents.length === 0 ? (
          <Empty>Инцидентов не было</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Начало</th>
                <th>Длительность</th>
                <th>Причина</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((incident) => (
                <tr key={incident.id}>
                  <td>{formatDateTime(incident.startedAt)}</td>
                  <td>
                    {formatDuration(
                      new Date(incident.resolvedAt ?? Date.now()).getTime() -
                        new Date(incident.startedAt).getTime(),
                    )}
                  </td>
                  <td>{incident.lastErrorMessage ?? '—'}</td>
                  <td style={{ color: incident.resolvedAt ? undefined : statusColor('down') }}>
                    {incident.resolvedAt ? 'закрыт' : 'открыт'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
