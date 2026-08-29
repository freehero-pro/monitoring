export const theme = {
  colors: {
    background: '#f6f7f9',
    surface: '#ffffff',
    border: '#e3e6ea',
    text: '#16191d',
    muted: '#6b7280',
    accent: '#2563eb',
    accentSoft: '#eff4ff',
    up: '#16a34a',
    degraded: '#d97706',
    down: '#dc2626',
    unknown: '#9ca3af',
  },
  radius: '10px',
  shadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.1)',
} as const;

export type Theme = typeof theme;

export type StatusKey = 'up' | 'degraded' | 'down' | 'unknown';

export const STATUS_LABELS: Record<StatusKey, string> = {
  up: 'Работает',
  degraded: 'Замедление',
  down: 'Недоступен',
  unknown: 'Нет данных',
};

export function statusColor(status: string): string {
  return theme.colors[(status as StatusKey) in theme.colors ? (status as StatusKey) : 'unknown'];
}
