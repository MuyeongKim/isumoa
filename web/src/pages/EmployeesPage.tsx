import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Search, UserPlus, Trash2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  type Department,
  type Employee,
  type EmployeeStatus,
  type RosterTrashResult,
} from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Pager, Table, Td, Th, Tr } from '@/components/ui/Table';
import { Tag, type Tone } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';
import { EmployeeDialog } from './EmployeeDialog';

const PAGE_SIZE = 50;

const STATUS_TONES: Record<EmployeeStatus, Tone> = {
  active: 'neutral',
  leave: 'warn',
  dispatched: 'navy',
  retired: 'neutral',
};

type StatusFilter = EmployeeStatus | 'current' | 'all';

export function EmployeesPage() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const isAdmin = me.role === 'admin';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('current');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [trash, setTrash] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const departmentId = Number(params.get('departmentId')) || null;

  const employees = useQuery({ queryKey: ['employees', { trash }], queryFn: () => api.get<Employee[]>(`/employees${trash ? '?trash=1' : ''}`) });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });

  const filtered = useMemo(() => {
    const word = keyword.replace(/\s+/g, '');
    return (employees.data ?? []).filter((e) => {
      if (departmentId && e.departmentId !== departmentId) return false;
      if (statusFilter === 'current' && e.status === 'retired') return false;
      if (statusFilter !== 'current' && statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (word && !e.name.replace(/\s+/g, '').includes(word) && !(e.empNo ?? '').includes(word)) return false;
      return true;
    });
  }, [employees.data, departmentId, statusFilter, keyword]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const total = employees.data?.length ?? 0;
  const chosen = filtered.filter(e => selected.has(e.id));
  const allPageSelected = rows.length > 0 && rows.every(e => selected.has(e.id));
  const remove = useMutation({
    mutationFn: (ids: number[]) => api.post<RosterTrashResult>(`/employees/bulk-${trash ? 'restore' : 'delete'}`, { ids }),
    onSuccess: result => {
      toast.success(`직원 ${result.changed}명을 ${trash ? '복원했습니다.' : '휴지통으로 옮겼습니다.'}`);
      setSelected(new Set()); setConfirming(false);
      void queryClient.invalidateQueries();
    },
    onError: err => toast.error(errorMessage(err)),
  });
  function select(id: number, checked: boolean) {
    setSelected(previous => { const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next; });
  }

  return (
    <>
      <PageHeader
        title={trash ? '삭제한 직원' : '직원 명단'}
        description={
          trash ? '삭제한 직원을 선택해 복원합니다. 부서와 함께 삭제했다면 부서를 먼저 복원해 주세요.' : me.role === 'admin'
            ? '이수 현황을 셀 직원 명단입니다. 인사 명단 엑셀을 올리면 한 번에 등록하고 바뀐 내용을 반영합니다.'
            : '담당 부서 직원 명단입니다. 새로 온 직원은 직접 추가할 수 있습니다.'
        }
        actions={
          <>
            {isAdmin && <Button disabled={remove.isPending} onClick={() => { setTrash(!trash); setSelected(new Set()); setPage(1); setStatusFilter(trash ? 'current' : 'all'); }}>
              {trash ? <RotateCcw className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {trash ? '직원 명단으로' : '삭제한 직원 보기'}
            </Button>}
            {!trash && <>
            <Button onClick={() => setEditing('new')}>
              <UserPlus className="size-4" aria-hidden />
              직원 추가
            </Button>
            {me.role === 'admin' && (
              <Button variant="primary" onClick={() => navigate('/employees/import')}>
                <FileSpreadsheet className="size-4" aria-hidden />
                엑셀로 일괄 등록
              </Button>
            )}
            </>}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-faint" aria-hidden />
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
              setSelected(new Set());
            }}
            placeholder="이름 또는 사번"
            className="pl-8"
            aria-label="이름 또는 사번 검색"
          />
        </div>
        <Select
          className="w-48"
          value={departmentId ?? ''}
          aria-label="부서"
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('departmentId', e.target.value);
            else next.delete('departmentId');
            setParams(next, { replace: true });
            setPage(1);
            setSelected(new Set());
          }}
        >
          <option value="">{me.role === 'admin' ? '전체 부서' : '담당 부서 전체'}</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-40"
          value={statusFilter}
          aria-label="재직 상태"
          onChange={(e) => {
            setStatusFilter(e.target.value as StatusFilter);
            setPage(1);
            setSelected(new Set());
          }}
        >
          <option value="current">퇴직자 제외</option>
          <option value="all">전체</option>
          {EMPLOYEE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EMPLOYEE_STATUS_LABELS[s]}만
            </option>
          ))}
        </Select>
      </div>
      {isAdmin && <div className="mb-4 flex flex-wrap items-center gap-3 text-[14px]">
        <span className="text-ink-soft" role="status">{chosen.length}명 선택</span>
        <Button variant={trash ? 'secondary' : 'danger'} size="sm" disabled={!chosen.length} loading={remove.isPending}
          onClick={() => trash ? remove.mutate(chosen.map(e => e.id)) : setConfirming(true)}>{trash ? '선택 복원' : '선택 삭제'}</Button>
        {chosen.length > 0 && <Button size="sm" onClick={() => setSelected(new Set())}>선택 해제</Button>}
        {allPageSelected && filtered.length > rows.length && filtered.length <= 1000 && chosen.length < filtered.length &&
          <Button size="sm" onClick={() => setSelected(new Set(filtered.map(e => e.id)))}>검색 결과 {filtered.length}명 모두 선택</Button>}
        <span className="text-[12.5px] text-ink-faint">{trash ? '부서도 삭제했다면 설정에서 부서를 먼저 복원해 주세요.' : '삭제한 직원의 이수증은 보관하며, 휴지통에서 복원할 수 있습니다.'}</span>
      </div>}

      {employees.isPending ? (
        <LoadingRows />
      ) : total === 0 ? (
        <EmptyState
          title={trash ? '삭제한 직원이 없습니다' : '등록된 직원이 없습니다'}
          description={
            trash ? '삭제한 직원은 이곳에서 복원할 수 있습니다.' : me.role === 'admin'
              ? '인사 명단 엑셀(.xlsx)이나 CSV를 올리면 부서와 직원을 한 번에 등록합니다.'
              : '관리자가 인사 명단을 올리면 담당 부서 직원이 여기에 나타납니다.'
          }
          action={
            !trash && me.role === 'admin' && (
              <Button variant="primary" onClick={() => navigate('/employees/import')}>
                엑셀로 일괄 등록
              </Button>
            )
          }
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                {isAdmin && <Th className="w-12"><input type="checkbox" className="size-4 accent-navy" aria-label="이 페이지 직원 전체 선택" checked={allPageSelected}
                  ref={el => { if (el) el.indeterminate = rows.some(e => selected.has(e.id)) && !allPageSelected; }}
                  onChange={e => setSelected(previous => { const next = new Set(previous); rows.forEach(row => e.target.checked ? next.add(row.id) : next.delete(row.id)); return next; })} /></Th>}
                <Th className="w-24">사번</Th>
                <Th>성명</Th>
                <Th>부서</Th>
                <Th>직급·직위</Th>
                <Th>직종</Th>
                <Th>생년월일</Th>
                <Th>상태</Th>
                <Th className="w-16">
                  <span className="sr-only">수정</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <Tr key={e.id} className={e.status === 'retired' ? 'text-ink-faint' : undefined}>
                  {isAdmin && <Td><input type="checkbox" className="size-4 accent-navy" aria-label={`${e.name}${e.empNo ? ` (${e.empNo})` : ''} 선택`} checked={selected.has(e.id)} onChange={event => select(e.id, event.target.checked)} /></Td>}
                  <Td className="tabular-nums text-ink-soft">{e.empNo ?? '-'}</Td>
                  <Td className="font-medium">{e.name}</Td>
                  <Td>{e.departmentName ?? '-'}</Td>
                  <Td>{e.position ?? '-'}</Td>
                  <Td>{e.empType ?? '-'}</Td>
                  <Td className="tabular-nums">{e.birthDate ?? '-'}</Td>
                  <Td>
                    <Tag tone={STATUS_TONES[e.status]}>{EMPLOYEE_STATUS_LABELS[e.status]}</Tag>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {!trash && <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                      onClick={() => setEditing(e)}
                    >
                      수정
                    </button>}
                    {isAdmin && <button type="button" className="rounded px-2 py-1 text-[13px] text-seal hover:bg-seal-soft"
                      onClick={() => { if (trash) remove.mutate([e.id]); else { setSelected(new Set([e.id])); setConfirming(true); } }}>{trash ? '복원' : '삭제'}</button>}
                  </Td>
                </Tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <Td colSpan={isAdmin ? 9 : 8} className="py-10 text-center text-ink-faint">
                    조건에 맞는 직원이 없습니다.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
          <Pager
            page={currentPage}
            pageCount={pageCount}
            onPage={setPage}
            summary={
              filtered.length === total
                ? `총 ${formatNumber(total)}명`
                : `${formatNumber(total)}명 중 ${formatNumber(filtered.length)}명`
            }
          />
        </>
      )}

      <EmployeeDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        employee={editing === 'new' ? null : editing}
        departments={(departments.data ?? []).filter((d) => d.active)}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog open={confirming} title="선택한 직원을 삭제할까요?"
        description={<p>직원 {chosen.length}명을 휴지통으로 옮깁니다. 이수증과 과거 기록은 보관하고, 이수 현황·직원 매칭·내보내기에서는 제외합니다. 삭제한 직원 보기에서 복원할 수 있습니다.</p>}
        confirmLabel="휴지통으로 이동" busy={remove.isPending} onClose={() => { if (!remove.isPending) setConfirming(false); }} onConfirm={() => remove.mutate(chosen.map(e => e.id))} />
    </>
  );
}
