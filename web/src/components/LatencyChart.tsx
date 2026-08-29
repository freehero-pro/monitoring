import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { theme } from '../theme';
import { formatMs, formatTime } from '../format';
import type { SeriesPoint } from '../api/types';

export function LatencyChart({ series }: { series: SeriesPoint[] }) {
  const data = series.map((point) => ({
    bucket: point.bucket,
    p50: point.p50Ms,
    p95: point.p95Ms,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="p95" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={theme.colors.accent} stopOpacity={0.25} />
            <stop offset="100%" stopColor={theme.colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={theme.colors.border} vertical={false} />
        <XAxis
          dataKey="bucket"
          tickFormatter={formatTime}
          tick={{ fontSize: 12, fill: theme.colors.muted }}
          stroke={theme.colors.border}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(value) => `${value}`}
          tick={{ fontSize: 12, fill: theme.colors.muted }}
          stroke={theme.colors.border}
          width={48}
        />
        <Tooltip
          labelFormatter={(value) => new Date(String(value)).toLocaleString('ru-RU')}
          formatter={(value, name) => [
            formatMs(typeof value === 'number' ? value : null),
            name === 'p95' ? 'p95' : 'медиана',
          ]}
        />
        <Legend
          formatter={(value) => (value === 'p95' ? 'p95' : 'медиана')}
          wrapperStyle={{ fontSize: 12 }}
        />
        <Area
          type="monotone"
          dataKey="p95"
          stroke={theme.colors.accent}
          fill="url(#p95)"
          strokeWidth={1.8}
          connectNulls
        />
        <Area
          type="monotone"
          dataKey="p50"
          stroke={theme.colors.up}
          fill="none"
          strokeWidth={1.6}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
