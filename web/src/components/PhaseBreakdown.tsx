import styled from 'styled-components';
import { formatMs } from '../format';
import type { CheckResult } from '../api/types';

const PHASE_COLORS = ['#818cf8', '#38bdf8', '#34d399', '#fbbf24'];

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Track = styled.div`
  display: flex;
  height: 12px;
  border-radius: 6px;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.background};
`;

const Segment = styled.div<{ $color: string }>`
  background: ${({ $color }) => $color};
`;

const Legend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
`;

const Dot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 6px;
  background: ${({ $color }) => $color};
`;

/**
 * Разбивка последнего ответа по фазам: DNS, TCP, TLS и ожидание ответа сервера.
 * Отвечает на вопрос «тормозит сеть или само приложение».
 */
export function PhaseBreakdown({ result }: { result: CheckResult }) {
  const phases = [
    { label: 'DNS', value: result.dnsMs },
    { label: 'TCP', value: result.connectMs },
    { label: 'TLS', value: result.tlsMs },
    {
      label: 'ответ сервера',
      value:
        result.ttfbMs === null
          ? null
          : Math.max(
              0,
              result.ttfbMs - (result.dnsMs ?? 0) - (result.connectMs ?? 0) - (result.tlsMs ?? 0),
            ),
    },
  ].filter((phase): phase is { label: string; value: number } => phase.value !== null);

  const total = phases.reduce((sum, phase) => sum + phase.value, 0);
  if (total === 0) return null;

  return (
    <Wrapper>
      <Track>
        {phases.map((phase, index) => (
          <Segment
            key={phase.label}
            $color={PHASE_COLORS[index % PHASE_COLORS.length]!}
            style={{ width: `${(phase.value / total) * 100}%` }}
            title={`${phase.label}: ${formatMs(phase.value)}`}
          />
        ))}
      </Track>
      <Legend>
        {phases.map((phase, index) => (
          <span key={phase.label}>
            <Dot $color={PHASE_COLORS[index % PHASE_COLORS.length]!} />
            {phase.label} — {formatMs(phase.value)}
          </span>
        ))}
      </Legend>
    </Wrapper>
  );
}
