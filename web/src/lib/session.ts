import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppMeta, SessionUser } from '@shared/types.ts';
import { api, ApiError } from './api.ts';

export function useMeta() {
  return useQuery({ queryKey: ['meta'], queryFn: () => api.get<AppMeta>('/meta'), staleTime: 60_000 });
}

/** 로그인한 사용자. 로그인하지 않았으면 null */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<SessionUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 30_000,
  });
}

/** 로그인한 사용자 (로그인 확인을 거친 화면 안에서만 쓴다) */
export function useCurrentUser(): SessionUser {
  const { data } = useMe();
  if (!data) throw new Error('로그인 정보가 없습니다.');
  return data;
}

export function useLogout() {
  const queryClient = useQueryClient();
  return async () => {
    await api.post('/auth/logout').catch(() => undefined);
    queryClient.clear();
    window.location.href = '/login';
  };
}
