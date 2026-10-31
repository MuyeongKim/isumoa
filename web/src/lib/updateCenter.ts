import { useQuery } from '@tanstack/react-query';
import type { UpdateCenterStatus } from '@shared/updateCenter.ts';
import { api } from './api';
import { useCurrentUser } from './session';
export function useUpdateCenter() {
  const user=useCurrentUser();
  return useQuery({queryKey:['update-center'],queryFn:()=>api.get<UpdateCenterStatus>('/system/updates'),enabled:user.role==='admin',staleTime:15_000,
    refetchInterval:q=>q.state.data?.checking||['checking','downloading','installing'].includes(q.state.data?.program.installer.phase??'')?1000:60_000,retry:1});
}
