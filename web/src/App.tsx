import { Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { theme } from './theme';
import { GlobalStyle, Empty } from './ui';
import { Layout } from './components/Layout';
import { useCurrentUser } from './hooks/useCurrentUser';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { CheckDetailPage } from './pages/CheckDetail';
import { CheckFormPage } from './pages/CheckForm';
import { IncidentsPage } from './pages/Incidents';
import { ChannelsPage } from './pages/Channels';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useCurrentUser();
  if (isLoading) return <Empty style={{ padding: 40, textAlign: 'center' }}>Загружаем…</Empty>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useCurrentUser();
  if (user && user.role !== 'admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ThemeProvider theme={theme}>
      <GlobalStyle />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<OverviewPage />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route
            path="/checks/new"
            element={
              <RequireAdmin>
                <CheckFormPage />
              </RequireAdmin>
            }
          />
          <Route path="/checks/:id" element={<CheckDetailPage />} />
          <Route
            path="/checks/:id/edit"
            element={
              <RequireAdmin>
                <CheckFormPage />
              </RequireAdmin>
            }
          />
          <Route
            path="/channels"
            element={
              <RequireAdmin>
                <ChannelsPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ThemeProvider>
  );
}
