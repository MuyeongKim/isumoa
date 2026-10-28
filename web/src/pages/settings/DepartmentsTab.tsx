import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, RotateCcw, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Department, RosterTrashResult } from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';

export function DepartmentsTab() {
  const queryClient = useQueryClient();
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const departments = useQuery({ queryKey: ['departments', { trash }], queryFn: () => api.get<Department[]>(`/departments${trash ? '?trash=1' : ''}`) });
  const [renaming, setRenaming] = useState<number | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['departments'] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
    ]);

  const save = useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: Record<string, unknown> }) =>
      id === null ? api.post('/departments', body) : api.patch(`/departments/${id}`, body),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (ids: number[]) => api.post<RosterTrashResult>(`/departments/bulk-${trash ? 'restore' : 'delete'}`, { ids }),
    onSuccess: (result) => {
      toast.success(`부서 ${result.changed}개${result.employees ? ` · 직원 ${result.employees}명` : ''} ${trash ? '복원 완료' : '휴지통으로 이동 완료'}`);
      setSelected(new Set());
      setConfirming(false);
      void queryClient.invalidateQueries();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const name = String(new FormData(formEl).get('name')).trim();
    if (!name) return;
    await save.mutateAsync({ id: null, body: { name } });
    toast.success(`${name}을(를) 추가했습니다.`);
    formEl.reset();
  }

  /** 이웃한 부서와 순서를 맞바꾼다 */
  async function move(list: Department[], index: number, offset: -1 | 1) {
    const a = list[index];
    const b = list[index + offset];
    if (!b) return;
    await save.mutateAsync({ id: a.id, body: { sortOrder: b.sortOrder } });
    await save.mutateAsync({ id: b.id, body: { sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + offset : a.sortOrder } });
  }

  const list = departments.data ?? [];
  const chosen = list.filter(d => selected.has(d.id));
  const allSelected = list.length > 0 && chosen.length === list.length;
  function select(id: number, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
      {!trash && <form onSubmit={add} className="flex max-w-md gap-2">
        <Input name="name" placeholder="새 부서 이름" aria-label="새 부서 이름" />
        <Button type="submit" variant="primary" loading={save.isPending && renaming === null}>
          부서 추가
        </Button>
      </form>}
      {trash && <p className="text-[14px] font-semibold">삭제한 부서</p>}
      <Button disabled={remove.isPending} onClick={() => { setTrash(!trash); setSelected(new Set()); setRenaming(null); }}>
        {trash ? <RotateCcw className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
        {trash ? '부서 목록으로' : '삭제한 부서 보기'}
      </Button>
      </div>
      {chosen.length > 0 && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-4 py-2" role="status">
        <span className="text-[14px]">부서 {chosen.length}개 선택</span>
        <Button size="sm" loading={remove.isPending} onClick={() => trash ? remove.mutate(chosen.map(d => d.id)) : setConfirming(true)}>
          {trash ? '선택 복원' : '선택 삭제'}
        </Button>
        <Button size="sm" onClick={() => setSelected(new Set())}>선택 해제</Button>
      </div>}

      {departments.isPending ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState
          title={trash ? '삭제한 부서가 없습니다' : '부서가 없습니다'}
          description={trash ? '삭제한 부서는 이곳에서 선택해 복원할 수 있습니다.' : '직원 명단 엑셀을 올리면 명단에 적힌 부서가 함께 만들어집니다. 여기서 직접 추가해도 됩니다.'}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-12"><input type="checkbox" className="size-4 accent-navy" aria-label="부서 전체 선택" checked={allSelected}
                ref={el => { if (el) el.indeterminate = chosen.length > 0 && !allSelected; }}
                onChange={e => setSelected(e.target.checked ? new Set(list.map(d => d.id)) : new Set())} /></Th>
              <Th className="w-20">순서</Th>
              <Th>부서</Th>
              <Th className="w-24 text-right">재직 직원</Th>
              <Th className="w-20 text-right">서무</Th>
              <Th className="w-20">사용</Th>
              <Th className="w-40">
                <span className="sr-only">관리</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {list.map((d, index) => (
              <Tr key={d.id} className={cn(!d.active && 'text-ink-faint')}>
                <Td><input type="checkbox" className="size-4 accent-navy" aria-label={`${d.name} 선택`} checked={selected.has(d.id)} onChange={e => select(d.id, e.target.checked)} /></Td>
                <Td>
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`${d.name} 위로`}
                      disabled={trash || index === 0 || save.isPending}
                      onClick={() => void move(list, index, -1)}
                      className="rounded p-1 text-ink-soft hover:bg-navy-soft disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${d.name} 아래로`}
                      disabled={trash || index === list.length - 1 || save.isPending}
                      onClick={() => void move(list, index, 1)}
                      className="rounded p-1 text-ink-soft hover:bg-navy-soft disabled:opacity-30"
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                  </div>
                </Td>
                <Td className="font-medium">
                  {renaming === d.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const name = String(new FormData(e.currentTarget).get('name')).trim();
                        if (name && name !== d.name) {
                          await save.mutateAsync({ id: d.id, body: { name } });
                          toast.success(`부서 이름을 ${name}(으)로 바꿨습니다.`);
                        }
                        setRenaming(null);
                      }}
                    >
                      <Input name="name" defaultValue={d.name} autoFocus className="h-8 max-w-60" aria-label="부서 이름" />
                      <Button type="submit" size="sm" variant="primary">
                        저장
                      </Button>
                      <Button size="sm" onClick={() => setRenaming(null)}>
                        취소
                      </Button>
                    </form>
                  ) : (
                    d.name
                  )}
                </Td>
                <Td className="text-right tabular-nums">{formatNumber(d.employeeCount)}</Td>
                <Td className="text-right tabular-nums">{formatNumber(d.clerkCount)}</Td>
                <Td>
                  <Switch
                    disabled={trash}
                    checked={d.active}
                    label={`${d.name} 사용`}
                    onChange={(active) => save.mutate({ id: d.id, body: { active } })}
                  />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {!trash && <button
                    type="button"
                    className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                    onClick={() => setRenaming(d.id)}
                  >
                    이름 변경
                  </button>}
                  {
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-seal hover:bg-seal-soft"
                      onClick={() => { if (trash) remove.mutate([d.id]); else { setSelected(new Set([d.id])); setConfirming(true); } }}
                    >
                      {trash ? '복원' : '삭제'}
                    </button>
                  }
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-[12.5px] text-ink-faint">
        부서를 삭제하면 소속 직원도 함께 휴지통으로 옮깁니다. 이수증·기존 기록·서무 연결은 보관되며, 부서를 복원하면 함께 삭제한 직원도 복원됩니다.
      </p>
      <ConfirmDialog open={confirming} title="선택한 부서를 삭제할까요?"
        description={<p>부서 {chosen.length}개와 소속 직원 {chosen.reduce((n, d) => n + (d.memberCount ?? d.employeeCount), 0)}명을 휴지통으로 옮깁니다. 이수증은 보관하고, 현황·내보내기에서 제외합니다. 삭제한 부서 보기에서 복원할 수 있습니다.</p>}
        confirmLabel="휴지통으로 이동" busy={remove.isPending} onClose={() => { if (!remove.isPending) setConfirming(false); }} onConfirm={() => remove.mutate(chosen.map(d => d.id))} />
    </div>
  );
}
