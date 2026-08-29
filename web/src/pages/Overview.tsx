import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Certificate, CheckSummary, Incident } from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { Sparkline } from '../components/Sparkline';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { formatAgo, formatDuration, formatMs, formatUptime } from '../format';
import {
  Banner,
  Button,
  Card,
  Empty,
  Grid,
  PageHeader,
  Row,
  Select,
  Stack,
  Subtitle,
  Tag,
  Title,
} from '../ui';
import { statusColor } from '../theme';

const CheckCard = styled(Card)<{ $status: string }>`
  border-left: 3px solid ${({ $status }) => statusColor($status)};
`;

const Name = styled(Link)`
  font-weight: 600;
  font-size: 15px;
  color: inherit;

  &:hover { color: ${({ theme }) => theme.colors.accent}; text-decoration: none; }
`;

const Url = styled.div`
  color: ${({ theme }) => theme.colors.muted};
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Metrics = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
`;

const Metric = styled.div`
  display: flex;
  flex-direction: column;

  span:first-child {
    font-size: 12px;
    color: ${({ theme }) => theme.colors.muted};
  }
  span:last-child {
    font-weight: 600;
  }
`;

const Disabled = styled(Tag)`
  color: ${({ theme }) => theme.colors.muted};
`;

export function OverviewPage() {
  const { user } = useCurrentUser();
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  const checksQuery = useQuery({
    queryKey: ['checks'],
    queryFn: () => api.get<{ checks: CheckSummary[] }>('/api/checks'),
    refetchInterval: 30_000,
  });

  const incidentsQuery = useQuery({
    queryKey: ['incidents', 'open'],
    queryFn: () => api.get<{ incidents: Incident[] }>('/api/incidents?open=true'),
    refetchInterval: 30_000,
  });

  const certificatesQuery = useQuery({
    queryKey: ['certificates'],
    queryFn: () => api.get<{ certificates: Certificate[] }>('/api/certificates'),
  });

  const checks = checksQuery.data?.checks ?? [];
  const tags = useMemo(
    () => [...new Set(checks.flatMap((check) => check.tags))].sort(),
    [checks],
  );

  const visible = checks.filter(
    (check) =>
      (statusFilter === 'all' || check.currentStatus === statusFilter) &&
      (tagFilter === 'all' || check.tags.includes(tagFilter)),
  );

  const expiring = (certificatesQuery.data?.certificates ?? []).filter(
    (certificate) => certificate.daysRemaining !== null && certificate.daysRemaining < 14,
  );

  return (
    <Stack $gap={16}>
      <PageHeader>
        <div>
          <Title>Проверки</Title>
          <Subtitle>
            {checks.length === 0
              ? 'Пока ничего не проверяется'
              : `${checks.length} проверок, ${checks.filter((check) => check.currentStatus === 'up').length} в норме`}
          </Subtitle>
        </div>
        <Row>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">Все статусы</option>
            <option value="up">Работают</option>
            <option value="degraded">Замедление</option>
            <option value="down">Недоступны</option>
            <option value="unknown">Нет данных</option>
          </Select>
          {tags.length > 0 && (
            <Select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="all">Все теги</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </Select>
          )}
          {user?.role === 'admin' && (
            <Button as={Link} to="/checks/new">
              Добавить проверку
            </Button>
          )}
        </Row>
      </PageHeader>

      {(incidentsQuery.data?.incidents.length ?? 0) > 0 && (
        <Banner $tone="down">
          <strong>Открытые инциденты</strong>
          <Stack $gap={4} style={{ marginTop: 6 }}>
            {incidentsQuery.data!.incidents.map((incident) => (
              <div key={incident.id}>
                <Link to={`/checks/${incident.checkId}`}>{incident.checkName}</Link> — уже{' '}
                {formatDuration(incident.durationMs)}
                {incident.lastErrorMessage ? `, ${incident.lastErrorMessage}` : ''}
              </div>
            ))}
          </Stack>
        </Banner>
      )}

      {expiring.length > 0 && (
        <Banner $tone="degraded">
          <strong>Сертификаты скоро истекут</strong>
          <Stack $gap={4} style={{ marginTop: 6 }}>
            {expiring.map((certificate) => (
              <div key={certificate.checkId}>
                {certificate.host} — осталось {certificate.daysRemaining} дн.
              </div>
            ))}
          </Stack>
        </Banner>
      )}

      {checksQuery.isLoading && <Empty>Загружаем…</Empty>}
      {!checksQuery.isLoading && visible.length === 0 && (
        <Empty>
          Ничего не найдено.{' '}
          {user?.role === 'admin' && checks.length === 0 && (
            <Link to="/checks/new">Добавьте первую проверку</Link>
          )}
        </Empty>
      )}

      <Grid $min="320px">
        {visible.map((check) => (
          <CheckCard key={check.id} $status={check.currentStatus}>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Name to={`/checks/${check.id}`}>{check.name}</Name>
                <Url title={check.url}>{check.url}</Url>
              </div>
              <StatusBadge status={check.currentStatus} />
            </Row>

            <Metrics>
              <Metric>
                <span>Uptime 24 ч</span>
                <span>{formatUptime(check.uptime)}</span>
              </Metric>
              <Metric>
                <span>p95</span>
                <span>{formatMs(check.p95Ms)}</span>
              </Metric>
              <Metric>
                <span>Последний ответ</span>
                <span>{formatMs(check.lastTotalMs)}</span>
              </Metric>
            </Metrics>

            <Row style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <Sparkline values={check.sparkline} color={statusColor(check.currentStatus)} />
              <span style={{ fontSize: 12, color: '#6b7280' }}>{formatAgo(check.lastCheckedAt)}</span>
            </Row>

            {(check.tags.length > 0 || !check.enabled) && (
              <Row $gap={6} $wrap style={{ marginTop: 10 }}>
                {!check.enabled && <Disabled>выключена</Disabled>}
                {check.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Row>
            )}
          </CheckCard>
        ))}
      </Grid>
    </Stack>
  );
}
