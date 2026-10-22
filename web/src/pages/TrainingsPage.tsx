import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Training } from '@shared/types.ts';
import { LoadingRows, PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { cn, requirementText } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';
import { TRAININGS_REVIEWED_KEY } from './HomePage';
import { TrainingDialog } from './TrainingDialog';

function yearRange(t: Training): string {
  if (!t.fromYear && !t.toYear) return '매년';
  return `${t.fromYear ?? ''}~${t.toYear ?? ''}`;
}

export function TrainingsPage() {
  const me = useCurrentUser();
  const isAdmin = me.role === 'admin';
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Training | 'new' | null>(null);
  const trainings = useQuery({ queryKey: ['trainings'], queryFn: () => api.get<Training[]>('/trainings') });

  // 관리자가 이 화면을 한 번 보면 첫 화면의 '교육 과정 기준 확인하기'를 끝난 것으로 표시한다
  useEffect(() => {
    if (!isAdmin) return;
    try {
      localStorage.setItem(TRAININGS_REVIEWED_KEY, '1');
    } catch {
      // 저장소를 못 쓰는 브라우저면 표시만 안 될 뿐 기능에는 영향 없음
    }
  }, [isAdmin]);

  const toggle = useMutation({
    mutationFn: (t: Training) => api.patch(`/trainings/${t.id}`, { active: !t.active }),
    onSuccess: (_data, t) => {
      toast.success(`${t.name}을(를) ${t.active ? '사용 안 함으로' : '사용으로'} 바꿨습니다.`);
      void queryClient.invalidateQueries({ queryKey: ['trainings'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <>
      <PageHeader
        title="교육 과정"
        description="이수 여부를 판단할 법정교육 목록입니다. 공공기관 기본 목록이 들어 있으니 기관 지침에 맞게 기준과 인식 키워드를 고쳐 주세요."
        actions={
          isAdmin && (
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              교육 추가
            </Button>
          )
        }
      />

      {trainings.isPending ? (
        <LoadingRows />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>교육</Th>
              <Th className="w-28">기준</Th>
              <Th>인식 키워드</Th>
              <Th className="w-24">적용</Th>
              <Th className="w-20">사용</Th>
              {isAdmin && (
                <Th className="w-16">
                  <span className="sr-only">수정</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {(trainings.data ?? []).map((t) => (
              <Tr key={t.id} className={cn(!t.active && 'bg-paper/60')}>
                <Td>
                  <p className={cn('font-medium', !t.active && 'text-ink-faint')}>
                    {t.name}
                    {t.category && <span className="ml-2 text-[12.5px] font-normal text-ink-faint">{t.category}</span>}
                  </p>
                  {t.legalBasis && <p className="mt-0.5 text-[12.5px] text-ink-faint">{t.legalBasis}</p>}
                </Td>
                <Td className="whitespace-nowrap">{requirementText(t.reqType, t.reqValue)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {t.keywords.map((k) => (
                      <span key={k} className="rounded bg-paper px-1.5 py-px text-[12.5px] text-ink-soft">
                        {k}
                      </span>
                    ))}
                    {t.keywords.length === 0 && <span className="text-[12.5px] text-seal">키워드 없음</span>}
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-ink-soft">{yearRange(t)}</Td>
                <Td>
                  {isAdmin ? (
                    <Switch
                      checked={t.active}
                      label={`${t.name} 사용`}
                      disabled={toggle.isPending}
                      onChange={() => toggle.mutate(t)}
                    />
                  ) : (
                    <span className={t.active ? 'text-ok' : 'text-ink-faint'}>{t.active ? '사용' : '안 함'}</span>
                  )}
                </Td>
                {isAdmin && (
                  <Td className="text-right whitespace-nowrap">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                      onClick={() => setEditing(t)}
                    >
                      수정
                    </button>
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-[12.5px] text-ink-faint">
        근거 법령과 기준은 참고용 기본값입니다. 국가법령정보센터와 기관 지침을 확인해 확정해 주세요.
      </p>

      <TrainingDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        training={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}
