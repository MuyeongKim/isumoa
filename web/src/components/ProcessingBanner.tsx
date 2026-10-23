import { useQuery } from '@tanstack/react-query';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import type { ProcessingStatus } from '@shared/types.ts';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';

function eta(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds < 60) return ' · 1분 안에 끝납니다';
  return ` · 약 ${Math.ceil(seconds / 60)}분 남음`;
}

/** 처리 대기열 현황. 처리할 쪽이 있는 동안 2초마다 새로 읽는다 */
export function useProcessing() {
  return useQuery({
    queryKey: ['processing'],
    queryFn: () => api.get<ProcessingStatus>('/processing'),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && data.waiting + data.running > 0 ? 2000 : 10_000;
    },
  });
}

export function ProcessingBanner() {
  const { data } = useProcessing();
  if (!data) return null;
  const active = data.waiting + data.running;
  if (active === 0 && data.failed === 0) return null;
  return (
    <div className="mb-5 space-y-2">
      {active > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-navy/20 bg-navy-soft px-4 py-2.5 text-[13.5px] text-navy">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          이수증 {formatNumber(active)}쪽을 읽는 중입니다{eta(data.etaSeconds)}. 다른 화면으로 가도 계속 처리하고, 끝난 것부터 바로 검수할 수 있습니다.
        </p>
      )}
      {data.failed > 0 && (
        <p className="flex items-center gap-2 rounded-xl border border-seal/30 bg-seal-soft px-4 py-2.5 text-[13.5px] text-seal">
          <TriangleAlert className="size-4" aria-hidden />
          {formatNumber(data.failed)}쪽은 세 번 시도해도 읽지 못했습니다. 올린 묶음 목록에서 확인해 주세요.
        </p>
      )}
    </div>
  );
}
