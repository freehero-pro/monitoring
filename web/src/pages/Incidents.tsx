import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Certificate, Incident } from '../api/types';
import { ERROR_KIND_LABELS, formatDateTime, formatDuration } from '../format';
import { Card, Empty, PageHeader, Select, Stack, Table, Title } from '../ui';

export function IncidentsPage() {
  const [openOnly, setOpenOnly] = useState(false);

  const incidents = useQuery({
    queryKey: ['incidents', openOnly],
    queryFn: () => api.get<{ incidents: Incident[] }>(`/api/incidents?open=${openOnly}`),
    refetchInterval: 60_000,
  });

  const certificates = useQuery({
    queryKey: ['certificates'],
    queryFn: () => api.get<{ certificates: Certificate[] }>('/api/certificates'),
  });

  const rows = incidents.data?.incidents ?? [];

  return (
    <Stack $gap={16}>
      <PageHeader>
        <Title>Инциденты</Title>
        <Select value={String(openOnly)} onChange={(event) => setOpenOnly(event.target.value === 'true')}>
          <option value="false">Все</option>
          <option value="true">Только открытые</option>
        </Select>
      </PageHeader>

      <Card>
        {rows.length === 0 ? (
          <Empty>Инцидентов нет</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Проверка</th>
                <th>Начало</th>
                <th>Длительность</th>
                <th>Причина</th>
                <th>Неудач</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((incident) => (
                <tr key={incident.id}>
                  <td>
                    <Link to={`/checks/${incident.checkId}`}>{incident.checkName}</Link>
                  </td>
                  <td>{formatDateTime(incident.startedAt)}</td>
                  <td>{formatDuration(incident.durationMs)}</td>
                  <td>
                    {incident.firstErrorKind
                      ? `${ERROR_KIND_LABELS[incident.firstErrorKind] ?? incident.firstErrorKind}: `
                      : ''}
                    {incident.lastErrorMessage ?? '—'}
                  </td>
                  <td>{incident.failedResultsCount}</td>
                  <td>{incident.resolvedAt ? 'закрыт' : 'открыт'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <Title as="h2" style={{ fontSize: 15, marginBottom: 12 }}>
          Сертификаты
        </Title>
        {(certificates.data?.certificates.length ?? 0) === 0 ? (
          <Empty>Пока нет данных: сертификат считывается при первой https-проверке</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Проверка</th>
                <th>Хост</th>
                <th>Издатель</th>
                <th>Действует до</th>
                <th>Осталось</th>
              </tr>
            </thead>
            <tbody>
              {certificates.data!.certificates.map((certificate) => (
                <tr key={certificate.checkId}>
                  <td>
                    <Link to={`/checks/${certificate.checkId}`}>{certificate.checkName}</Link>
                  </td>
                  <td>{certificate.host}</td>
                  <td>{certificate.issuer ?? '—'}</td>
                  <td>{formatDateTime(certificate.validTo)}</td>
                  <td>{certificate.daysRemaining === null ? '—' : `${certificate.daysRemaining} дн.`}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </Stack>
  );
}
