export function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${Math.round(value)} мс`;
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} с`;
}

export function formatUptime(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const percent = value * 100;
  const digits = percent >= 99.95 || percent === 0 ? 0 : percent >= 99 ? 2 : 1;
  return `${percent.toFixed(digits)} %`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  return `${Math.floor(hours / 24)} д ${hours % 24} ч`;
}

export function formatAgo(value: string | null | undefined): string {
  if (!value) return 'ещё не проверялась';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return 'только что';
  return `${formatDuration(diff)} назад`;
}

export const ERROR_KIND_LABELS: Record<string, string> = {
  dns: 'DNS',
  connect: 'соединение',
  tls: 'TLS',
  timeout: 'таймаут',
  http: 'код ответа',
  assertion: 'проверка ответа',
  unknown: 'ошибка',
};
