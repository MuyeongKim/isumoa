import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  COMPLETION_LABELS,
  type CertificateListItem,
  type CompletionState,
  type Department,
  type StatusCell,
  type StatusReport,
  type StatusRow,
  type Training,
} from '@shared/types.ts';
import { Search, X } from 'lucide-react';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { StateMark } from '@/components/StateMark';
import { Dialog } from '@/components/ui/Dialog';
import { Input, Select } from '@/components/ui/Field';
import { withBase } from '@/lib/base';
import { api } from '@/lib/api';
import { cn, formatNumber, requirementText } from '@/lib/format';
import { matchesName } from '@/lib/hangul';
import { useCurrentUser } from '@/lib/session';
import { shortTrainingName } from './review/ReviewPage';

const STATES: CompletionState[] = ['done', 'partial', 'none', 'exempt'];

function percent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)}%`;
}

function cellTitle(training: Training, cell: StatusCell): string {
  const base = `${training.name}: ${COMPLETION_LABELS[cell.state]}`;
  const detail = cell.note ?? (cell.count > 0 ? `${cell.count}건, ${cell.hours}시간` : '');
  return detail ? `${base} (${detail})` : base;
}

function CellDialog({
  target,
  year,
  onClose,
}: {
  target: { row: StatusRow; training: Training } | null;
  year: number;
  onClose: () => void;
}) {
  const certificates = useQuery({
    queryKey: ['certificates', 'cell', target?.row.employeeId, target?.training.id, year],
    queryFn: () =>
      api.get<CertificateListItem[]>(
        `/certificates?status=confirmed&employeeId=${target!.row.employeeId}&trainingId=${target!.training.id}&year=${year}`,
      ),
    enabled: target !== null,
  });
  const cell = target?.row.cells[target.training.id];
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target ? `${target.row.name} · ${target.training.name}` : ''}
      description={
        target && cell
          ? `${year}년 ${COMPLETION_LABELS[cell.state]}${cell.note ? ` (${cell.note})` : ''} · 기준 ${requirementText(target.training.reqType, target.training.reqValue)}`
          : undefined
      }
    >
      {certificates.data?.length === 0 ? (
        <p className="text-[13.5px] text-ink-soft">확정된 이수증이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {(certificates.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
              <img src={withBase(`/api/pages/${c.pageId}/thumb`)} alt="" className="h-14 w-10 rounded-sm border border-line object-cover object-top" />
              <div className="min-w-0 flex-1 text-[13.5px]">
                <p className="font-medium">{c.completedOn}</p>
                <p className="truncate text-ink-soft">
                  {c.hours !== null ? `${c.hours}시간 · ` : ''}
                  {c.fileName}
                </p>
              </div>
              <Link to={`/review?status=confirmed&id=${c.id}`} className="shrink-0 text-[13px] text-link hover:underline">
                원본 보기
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function StatusPage() {
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const departmentId = Number(params.get('departmentId')) || null;
  const onlyMissing = params.get('missing') === '1';
  const q = params.get('q') ?? '';
  // 마우스를 올린 교육 열 (행은 CSS로, 열은 이 값으로 칠한다)
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [opened, setOpened] = useState<{ row: StatusRow; training: Training } | null>(null);

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const report = useQuery({
    queryKey: ['status', year, departmentId],
    queryFn: () => api.get<StatusReport>(`/status?year=${year}${departmentId ? `&departmentId=${departmentId}` : ''}`),
  });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const data = report.data;
  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((r) => !onlyMissing || Object.values(r.cells).some((c) => c.state === 'none' || c.state === 'partial'))
        .filter((r) => matchesName(q, r.name, r.empNo)),
    [data, onlyMissing, q],
  );

  return (
    <>
      <PageHeader
        title="이수 현황"
        description={
          me.role === 'admin'
            ? '확정한 이수증으로 계산한 직원별·교육별 이수 여부입니다. 칸을 누르면 근거가 된 이수증을 볼 수 있습니다.'
            : '담당 부서 직원의 교육별 이수 여부입니다. 칸을 누르면 근거가 된 이수증을 볼 수 있습니다.'
        }
        actions={
          <>
            <Select className="w-32" value={year} onChange={(e) => setParam('year', e.target.value)} aria-label="연도">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </Select>
            <Select className="w-44" value={departmentId ?? ''} onChange={(e) => setParam('departmentId', e.target.value || null)} aria-label="부서">
              <option value="">{me.role === 'admin' ? '전체 부서' : '담당 부서 전체'}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {report.isPending || !data ? (
        <LoadingRows />
      ) : data.rows.length === 0 ? (
        <EmptyState title="대상 직원이 없습니다" description="직원 명단을 먼저 등록해 주세요." />
      ) : (
        <>
          <section aria-label="교육별 이수율" className="overflow-x-auto rounded-2xl border border-line bg-sheet shadow-surface">
            <table className="w-full border-collapse text-center text-[13.5px]">
              <thead>
                <tr>
                  <th className="w-28 border-b border-line bg-head px-4 py-2.5 text-left text-[12.5px] font-semibold text-ink-faint">교육</th>
                  {data.trainings.map((t) => (
                    <th key={t.id} className="border-b border-l border-line bg-head px-2 py-2.5 text-[12.5px] font-semibold text-ink-faint" title={t.name}>
                      {shortTrainingName(t.name)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-ink-soft">이수율</th>
                  {data.summary.map((s) => (
                    <td key={s.trainingId} className="border-l border-line px-2 py-3">
                      <span className="block text-[20px] font-bold tracking-[-0.02em] tabular-nums">{percent(s.rate)}</span>
                      <span className="mx-auto mt-1.5 block h-1.5 w-16 overflow-hidden rounded-full bg-ok-soft">
                        <span className="animate-grow-x block h-full rounded-full bg-ok" style={{ width: percent(s.rate ?? 0) }} />
                      </span>
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-line text-ink-soft">
                  <th className="px-4 py-2 text-left font-normal">이수 / 대상</th>
                  {data.summary.map((s) => (
                    <td key={s.trainingId} className="border-l border-line px-2 py-2 tabular-nums">
                      {formatNumber(s.done)} / {formatNumber(s.target)}
                      {s.partial > 0 && <span className="block text-[12px] text-warn">부분 {s.partial}</span>}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </section>

          <div className="mt-8 mb-3 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
              <Input
                value={q}
                onChange={(e) => setParam('q', e.target.value || null)}
                placeholder="이름·초성·사번으로 찾기"
                aria-label="직원 찾기"
                className="w-full pr-9 pl-9"
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setParam('q', null)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-ink-faint hover:bg-ink/[0.06] hover:text-ink"
                  aria-label="찾기 지우기"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 text-[14px] text-ink-soft">
              <input type="checkbox" className="size-4 accent-navy" checked={onlyMissing} onChange={(e) => setParam('missing', e.target.checked ? '1' : null)} />
              미이수·부분이수가 있는 직원만
            </label>
            <div className="ml-auto flex flex-wrap items-center gap-4 text-[13px] text-ink-soft" aria-label="칸 모양 설명">
              {STATES.map((s) => (
                <span key={s} className="flex items-center gap-1.5">
                  <StateMark state={s} />
                  {COMPLETION_LABELS[s]}
                </span>
              ))}
            </div>
          </div>

          <div className="max-h-[calc(100vh-360px)] overflow-auto rounded-2xl border border-line bg-sheet shadow-surface" onMouseLeave={() => setHoverCol(null)}>
            <table className="w-full border-collapse text-[14px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="sticky left-0 z-20 border-b border-line bg-head px-4 py-2.5 text-left text-[12.5px] font-semibold text-ink-faint">성명</th>
                  <th className="border-b border-line bg-head px-3 py-2.5 text-left text-[12.5px] font-semibold text-ink-faint">부서</th>
                  {data.trainings.map((t) => (
                    <th
                      key={t.id}
                      className={cn(
                        'border-b border-l border-line px-2 py-2.5 text-[12.5px] font-semibold transition-colors',
                        hoverCol === t.id ? 'bg-navy-soft text-navy' : 'bg-head text-ink-faint',
                      )}
                      title={t.name}
                    >
                      {shortTrainingName(t.name)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employeeId} className="group/row">
                    <td className="sticky left-0 border-b border-line bg-sheet px-4 py-1.5 font-semibold whitespace-nowrap group-hover/row:bg-navy-soft">
                      {row.name}
                      {row.empNo && <span className="ml-1.5 text-[12px] font-normal text-ink-faint">{row.empNo}</span>}
                    </td>
                    <td className="border-b border-line px-3 py-1.5 whitespace-nowrap text-ink-soft group-hover/row:bg-navy-soft/50">{row.departmentName ?? '-'}</td>
                    {data.trainings.map((t) => {
                      const cell = row.cells[t.id];
                      return (
                        <td
                          key={t.id}
                          className={cn(
                            'border-b border-l border-line p-0 text-center group-hover/row:bg-navy-soft/50',
                            hoverCol === t.id && 'bg-navy-soft/50',
                          )}
                        >
                          <button
                            type="button"
                            className="group/cell grid h-9 w-full place-items-center hover:bg-navy-soft"
                            title={cellTitle(t, cell)}
                            aria-label={cellTitle(t, cell)}
                            onMouseEnter={() => setHoverCol(t.id)}
                            onFocus={() => setHoverCol(t.id)}
                            onClick={() => setOpened({ row, training: t })}
                          >
                            <StateMark state={cell.state} className="transition-transform group-hover/cell:scale-125" />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={data.trainings.length + 2} className="py-12 text-center text-ink-faint">
                      {q ? `'${q}'에 맞는 직원이 없습니다.` : '모두 이수했습니다.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[13px] text-ink-faint">
            {rows.length !== data.rows.length ? `${formatNumber(data.rows.length)}명 중 ${formatNumber(rows.length)}명` : `총 ${formatNumber(data.rows.length)}명`} · 휴직·파견 중인 직원은 대상에서 뺍니다. 확정한 이수증만 셉니다.
          </p>
        </>
      )}
      <CellDialog target={opened} year={year} onClose={() => setOpened(null)} />
    </>
  );
}
