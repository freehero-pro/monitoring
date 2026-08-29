import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { CurrentUser } from '../api/types';

export function useCurrentUser() {
  const query = useQuery<CurrentUser | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<CurrentUser>('/api/auth/me');
      } catch (error) {
        // 401 — это не сбой, а «не вошёл»: роутер просто покажет страницу входа.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  return { user: query.data ?? null, isLoading: query.isLoading, isError: query.isError };
}
