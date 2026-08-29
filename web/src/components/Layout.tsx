import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { Page, Row } from '../ui';

const Bar = styled.header`
  background: ${({ theme }) => theme.colors.surface};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Inner = styled.div`
  max-width: 1120px;
  margin: 0 auto;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`;

const Brand = styled.span`
  font-weight: 650;
  margin-right: 8px;
`;

const Link = styled(NavLink)`
  color: ${({ theme }) => theme.colors.muted};
  font-weight: 550;
  padding: 6px 0;

  &.active {
    color: ${({ theme }) => theme.colors.text};
    box-shadow: inset 0 -2px 0 ${({ theme }) => theme.colors.accent};
  }

  &:hover { text-decoration: none; color: ${({ theme }) => theme.colors.text}; }
`;

const Email = styled.span`
  color: ${({ theme }) => theme.colors.muted};
  font-size: 13px;
`;

const LogoutButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.accent};
  cursor: pointer;
  font-size: 13px;
  padding: 0;
`;

export function Layout() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      queryClient.clear();
      navigate('/login');
    },
  });

  return (
    <>
      <Bar>
        <Inner>
          <Row $gap={18}>
            <Brand>Мониторинг</Brand>
            <Link to="/" end>
              Проверки
            </Link>
            <Link to="/incidents">Инциденты</Link>
            {user?.role === 'admin' && <Link to="/channels">Каналы</Link>}
          </Row>
          <Row $gap={12}>
            <Email>{user?.email}</Email>
            <LogoutButton type="button" onClick={() => logout.mutate()}>
              Выйти
            </LogoutButton>
          </Row>
        </Inner>
      </Bar>
      <Page>
        <Outlet />
      </Page>
    </>
  );
}
