import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FileUp, Trash2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { RosterTrashResult, Training } from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { cn, requirementText } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';
import { TRAININGS_REVIEWED_KEY } from './HomePage';
import { TrainingDialog } from './TrainingDialog';
import { TrainingImportDialog } from './TrainingImportDialog';

function yearRange(t: Training): string {
  if (!t.fromYear && !t.toYear) return '매년';
  return `${t.fromYear ?? ''}~${t.toYear ?? ''}`;
}

export function TrainingsPage() {
  const me = useCurrentUser();
  const isAdmin = me.role === 'admin';
  const queryClient = useQueryClient();
  const [reviewed, setReviewed] = useState(() => { try { return localStorage.getItem(TRAININGS_REVIEWED_KEY) === '1'; } catch { return false; } });
  const [editing, setEditing] = useState<Training | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number[] | null>(null);
  const trainings = useQuery({ queryKey: ['trainings', { trash }], queryFn: () => api.get<Training[]>(`/trainings${trash ? '?trash=1' : ''}`) });
  const list = trainings.data ?? [];
  const chosen = list.filter(t => selected.has(t.id));
  const allSelected = list.length > 0 && chosen.length === list.length;

  const remove = useMutation({
    mutationFn: ({ ids, restore }: { ids: number[]; restore: boolean }) =>
      api.post<RosterTrashResult>(`/trainings/bulk-${restore ? 'restore' : 'delete'}`, { ids }),
    onSuccess: (result, { restore }) => {
      toast.success(`교육 ${result.changed}개 ${restore ? '복원 완료' : '휴지통으로 이동 완료'}`);
      setSelected(new Set());
      setDeleting(null);
      void queryClient.invalidateQueries();
    },
    onError: err => toast.error(errorMessage(err)),
  });

  function select(id: number, checked: boolean) {
    setSelected(previous => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function markReviewed() {
    try { localStorage.setItem(TRAININGS_REVIEWED_KEY, '1'); } catch { /* 진행 표시만 저장하지 못함 */ }
    setReviewed(true);
    toast.success('교육 기준을 확인한 것으로 표시했습니다.');
  }

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
        title={trash ? '삭제한 교육 기준' : '교육 기준 관리'}
        description={trash ? '삭제한 교육을 선택해 복원합니다. 기존 이수증과 인정 내역은 보관됩니다.' : '기관에서 관리할 교육 목록과 연간 시간·횟수 기준을 정합니다. 교육 기준표를 가져오거나 직접 추가한 뒤 기관 지침과 대조해 주세요.'}
        actions={
          isAdmin && (
            <>
              <Button disabled={remove.isPending} onClick={() => { setTrash(!trash); setSelected(new Set()); }}>
                {trash ? <RotateCcw className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
                {trash ? '교육 목록으로' : '삭제한 교육 보기'}
              </Button>
              {!trash && <>
                {reviewed ? <span className="text-[12.5px] font-medium text-ok" role="status">기준 확인됨</span> : <Button onClick={markReviewed}>기준 확인 완료</Button>}
                <Button onClick={() => setImporting(true)}><FileUp className="size-4" aria-hidden />교육 기준표 가져오기</Button>
                <Button variant="primary" onClick={() => setEditing('new')}>
                  <Plus className="size-4" aria-hidden />
                  교육 기준 추가
                </Button>
              </>}
            </>
          )
        }
      />

      {isAdmin && <div className="mb-4 flex flex-wrap items-center gap-3 text-[14px]">
        <span role="status" className="text-ink-soft">교육 {chosen.length}개 선택</span>
        <Button size="sm" variant={trash ? 'secondary' : 'danger'} disabled={!chosen.length || toggle.isPending} loading={remove.isPending}
          onClick={() => trash ? remove.mutate({ ids: chosen.map(t => t.id), restore: true }) : setDeleting(chosen.map(t => t.id))}>
          {trash ? '선택 복원' : '선택 삭제'}
        </Button>
        {chosen.length > 0 && <Button size="sm" disabled={remove.isPending} onClick={() => setSelected(new Set())}>선택 해제</Button>}
        <span className="text-[12.5px] text-ink-faint">삭제한 교육의 이수증·인정 내역은 보관하며, 휴지통에서 복원할 수 있습니다.</span>
      </div>}

      {trainings.isPending ? (
        <LoadingRows />
      ) : list.length === 0 ? <EmptyState title={trash ? '삭제한 교육이 없습니다' : '등록된 교육이 없습니다'}
        description={trash ? '삭제한 교육은 이곳에서 선택해 복원할 수 있습니다.' : '교육 기준 추가 또는 교육 기준표 가져오기를 눌러 등록해 주세요.'} /> : (
        <Table>
          <thead>
            <tr>
              {isAdmin && <Th className="w-12"><input type="checkbox" className="size-4 accent-navy" aria-label="교육 전체 선택"
                checked={allSelected} disabled={remove.isPending}
                ref={el => { if (el) el.indeterminate = chosen.length > 0 && !allSelected; }}
                onChange={e => setSelected(e.target.checked ? new Set(list.map(t => t.id)) : new Set())} /></Th>}
              <Th>교육</Th>
              <Th className="w-28">기준</Th>
              <Th>인식 키워드</Th>
              <Th className="w-24">적용</Th>
              <Th className="w-20">사용</Th>
              {isAdmin && (
                <Th className="w-28">
                  <span className="sr-only">관리</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <Tr key={t.id} className={cn(!t.active && 'bg-paper/60')}>
                {isAdmin && <Td><input type="checkbox" className="size-4 accent-navy" aria-label={`${t.name} 선택`}
                  checked={selected.has(t.id)} disabled={remove.isPending} onChange={e => select(t.id, e.target.checked)} /></Td>}
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
                      disabled={trash || toggle.isPending || remove.isPending}
                      onChange={() => toggle.mutate(t)}
                    />
                  ) : (
                    <span className={t.active ? 'text-ok' : 'text-ink-faint'}>{t.active ? '사용' : '안 함'}</span>
                  )}
                </Td>
                {isAdmin && (
                  <Td className="text-right whitespace-nowrap">
                    {!trash && <button
                      type="button"
                      disabled={remove.isPending}
                      className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                      onClick={() => setEditing(t)}
                    >
                      수정
                    </button>}
                    <button type="button" aria-label={`${t.name} ${trash ? '복원' : '삭제'}`} disabled={remove.isPending || toggle.isPending}
                      className="rounded px-2 py-1 text-[13px] text-seal hover:bg-seal-soft disabled:opacity-40"
                      onClick={() => trash ? remove.mutate({ ids: [t.id], restore: true }) : setDeleting([t.id])}>
                      {trash ? '복원' : '삭제'}
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
        onImport={() => { setEditing(null); setImporting(true); }}
      />
      <TrainingImportDialog key={importing ? 'import-open' : 'import-closed'} open={importing} onClose={() => setImporting(false)} />
      <ConfirmDialog open={deleting !== null} title="선택한 교육을 삭제할까요?"
        description={<p>교육 {deleting?.length ?? 0}개를 휴지통으로 옮깁니다. 교육 목록·자동 분류·이수 현황·내보내기에서 제외하며, 기존 이수증과 인정 내역은 보관합니다. 삭제한 교육 보기에서 복원할 수 있습니다.</p>}
        confirmLabel="휴지통으로 이동" busy={remove.isPending} onClose={() => { if (!remove.isPending) setDeleting(null); }}
        onConfirm={() => { if (deleting) remove.mutate({ ids: deleting, restore: false }); }} />
    </>
  );
}
