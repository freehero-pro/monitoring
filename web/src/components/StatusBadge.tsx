import styled from 'styled-components';
import { STATUS_LABELS, statusColor, type StatusKey } from '../theme';

const Badge = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 550;
  font-size: 13px;
  color: ${({ $color }) => $color};

  &::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${({ $color }) => $color};
  }
`;

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge $color={statusColor(status)}>
      {STATUS_LABELS[status as StatusKey] ?? STATUS_LABELS.unknown}
    </Badge>
  );
}
