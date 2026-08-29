import styled from 'styled-components';
import { theme } from '../theme';
import { formatUptime } from '../format';
import type { SeriesPoint } from '../api/types';

const Bars = styled.div`
  display: flex;
  gap: 2px;
  align-items: stretch;
  height: 34px;
`;

const Bar = styled.div<{ $color: string }>`
  flex: 1 1 auto;
  min-width: 3px;
  border-radius: 2px;
  background: ${({ $color }) => $color};
`;

/** Полоса доступности по корзинам времени: сразу видно, когда именно было плохо. */
export function UptimeBar({ series }: { series: SeriesPoint[] }) {
  if (series.length === 0) return null;

  return (
    <Bars>
      {series.map((point) => {
        const uptime = point.uptime ?? null;
        const color =
          uptime === null
            ? theme.colors.border
            : uptime === 1
              ? theme.colors.up
              : uptime >= 0.9
                ? theme.colors.degraded
                : theme.colors.down;

        return (
          <Bar
            key={point.bucket}
            $color={color}
            title={`${new Date(point.bucket).toLocaleString('ru-RU')} — ${formatUptime(uptime)} (${point.total} проверок)`}
          />
        );
      })}
    </Bars>
  );
}
