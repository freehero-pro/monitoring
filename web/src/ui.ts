import styled, { createGlobalStyle, css } from 'styled-components';

export const GlobalStyle = createGlobalStyle`
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  a { color: ${({ theme }) => theme.colors.accent}; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export const Page = styled.div`
  max-width: 1120px;
  margin: 0 auto;
  padding: 24px 20px 64px;
`;

export const PageHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  flex-wrap: wrap;
`;

export const Title = styled.h1`
  margin: 0;
  font-size: 20px;
  font-weight: 650;
`;

export const Subtitle = styled.p`
  margin: 4px 0 0;
  color: ${({ theme }) => theme.colors.muted};
`;

export const Card = styled.section`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.radius};
  box-shadow: ${({ theme }) => theme.shadow};
  padding: 16px;
`;

export const Grid = styled.div<{ $min?: string }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${({ $min }) => $min ?? '280px'}, 1fr));
  gap: 14px;
`;

export const Row = styled.div<{ $gap?: number; $wrap?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ $gap }) => $gap ?? 10}px;
  flex-wrap: ${({ $wrap }) => ($wrap ? 'wrap' : 'nowrap')};
`;

export const Stack = styled.div<{ $gap?: number }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => $gap ?? 12}px;
`;

const buttonBase = css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 550;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.12s ease, border-color 0.12s ease;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

export const Button = styled.button<{ $variant?: 'primary' | 'secondary' | 'danger' }>`
  ${buttonBase}
  ${({ $variant = 'primary', theme }) =>
    $variant === 'primary'
      ? css`
          background: ${theme.colors.accent};
          color: #fff;
          &:hover:not(:disabled) { background: #1d4ed8; }
        `
      : $variant === 'danger'
        ? css`
            background: #fff;
            color: ${theme.colors.down};
            border-color: ${theme.colors.border};
            &:hover:not(:disabled) { border-color: ${theme.colors.down}; }
          `
        : css`
            background: #fff;
            color: ${theme.colors.text};
            border-color: ${theme.colors.border};
            &:hover:not(:disabled) { background: ${theme.colors.background}; }
          `}
`;

export const Input = styled.input`
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  background: #fff;
  color: inherit;

  &:focus {
    outline: 2px solid ${({ theme }) => theme.colors.accentSoft};
    border-color: ${({ theme }) => theme.colors.accent};
  }
`;

export const TextArea = styled.textarea`
  width: 100%;
  min-height: 90px;
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  resize: vertical;
`;

export const Select = styled.select`
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  font-family: inherit;
`;

export const Label = styled.label`
  display: block;
  font-weight: 550;
  margin-bottom: 6px;
`;

export const Field = styled.div`
  margin-bottom: 14px;
`;

export const Hint = styled.p`
  margin: 6px 0 0;
  color: ${({ theme }) => theme.colors.muted};
  font-size: 13px;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    text-align: left;
    padding: 8px 10px;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
    vertical-align: top;
  }

  th {
    color: ${({ theme }) => theme.colors.muted};
    font-weight: 550;
    white-space: nowrap;
  }

  tbody tr:last-child td { border-bottom: none; }
`;

export const Mono = styled.span`
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
`;

export const Tag = styled.span`
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.background};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.muted};
  font-size: 12px;
`;

export const Banner = styled.div<{ $tone: 'down' | 'degraded' | 'info' }>`
  border-radius: ${({ theme }) => theme.radius};
  padding: 12px 14px;
  border: 1px solid
    ${({ theme, $tone }) =>
      $tone === 'down' ? theme.colors.down : $tone === 'degraded' ? theme.colors.degraded : theme.colors.border};
  background: ${({ $tone }) =>
    $tone === 'down' ? '#fef2f2' : $tone === 'degraded' ? '#fffbeb' : '#fff'};
`;

export const Empty = styled.p`
  color: ${({ theme }) => theme.colors.muted};
  margin: 0;
  padding: 12px 0;
`;

export const ErrorText = styled.p`
  color: ${({ theme }) => theme.colors.down};
  margin: 8px 0 0;
`;
