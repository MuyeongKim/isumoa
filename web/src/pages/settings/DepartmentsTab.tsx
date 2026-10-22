import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { Department } from '@shared/types.ts';
import { EmptyState, LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';

export function DepartmentsTab() {
  const queryClient = useQueryClient();
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
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
    mutationFn: (d: Department) => api.delete(`/departments/${d.id}`),
    onSuccess: (_r, d) => {
      toast.success(`${d.name}을(를) 삭제했습니다.`);
      void refresh();
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

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="flex max-w-md gap-2">
        <Input name="name" placeholder="새 부서 이름" aria-label="새 부서 이름" />
        <Button type="submit" variant="primary" loading={save.isPending && renaming === null}>
          부서 추가
        </Button>
      </form>

      {departments.isPending ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState
          title="부서가 없습니다"
          description="직원 명단 엑셀을 올리면 명단에 적힌 부서가 함께 만들어집니다. 여기서 직접 추가해도 됩니다."
        />
      ) : (
        <Table>
          <thead>
            <tr>
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
                <Td>
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label={`${d.name} 위로`}
                      disabled={index === 0 || save.isPending}
                      onClick={() => void move(list, index, -1)}
                      className="rounded p-1 text-ink-soft hover:bg-navy-soft disabled:opacity-30"
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${d.name} 아래로`}
                      disabled={index === list.length - 1 || save.isPending}
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
                    checked={d.active}
                    label={`${d.name} 사용`}
                    onChange={(active) => save.mutate({ id: d.id, body: { active } })}
                  />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                    onClick={() => setRenaming(d.id)}
                  >
                    이름 변경
                  </button>
                  {d.employeeCount === 0 && d.clerkCount === 0 && (
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-seal hover:bg-seal-soft"
                      onClick={() => remove.mutate(d)}
                    >
                      삭제
                    </button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <p className="text-[12.5px] text-ink-faint">
        직원이나 서무가 연결된 부서는 삭제할 수 없습니다. 없어진 부서는 &lsquo;사용&rsquo;을 꺼 두세요.
      </p>
    </div>
  );
}
