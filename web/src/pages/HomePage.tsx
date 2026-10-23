import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { COMPLETION_LABELS, type Dashboard, type Department, type Overview, type StatusReport, type StatusRow, type Training } from '@shared/types.ts';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { useProcessing } from '@/components/ProcessingBanner';
import { ConfirmStamp } from '@/components/SealMark';
import { STATE_CELL } from '@/components/StateMark';
import { buttonClass } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn, formatNumber, requirementText } from '@/lib/format';
import { useCurrentUser, useMeta } from '@/lib/session';
import { shortTrainingName } from './review/ReviewPage';

export const TRAININGS_REVIEWED_KEY = 'ecp.trainingsReviewed';

function trainingsReviewed(): boolean {
  try {
    return localStorage.getItem(TRAININGS_REVIEWED_KEY) === '1';
  } catch {
    return false;
  }
}

function percent(rate: number | null): string {
  return rate === null ? '-' : `${Math.round(rate * 100)}%`;
}

const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 숫자가 0에서 목표값까지 올라간다 (대시보드를 처음 열 때 한 번) */
function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(REDUCED_MOTION ? target : 0);
  useEffect(() => {
    if (REDUCED_MOTION) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 4))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/** 비율 막대: 채운 부분과 같은 색의 옅은 바탕 (색이 아니라 길이와 숫자로 읽는다) */
function Meter({ rate, label, className, tall }: { rate: number | null; label: string; className?: string; tall?: boolean }) {
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rate === null ? undefined : Math.round(rate * 100)}
      title={label}
      className={cn('block overflow-hidden rounded-full bg-ok-soft', tall ? 'h-3' : 'h-2', className)}
    >
      <span className="animate-grow-x block h-full rounded-full bg-ok" style={{ width: `${(rate ?? 0) * 100}%` }} />
    </span>
  );
}

function Figure({ label, value, unit, to }: { label: string; value: number; unit: string; to: string }) {
  return (
    <Link to={to} viewTransition className="group rounded-xl px-4 py-3 transition-colors hover:bg-paper">
      <span className="flex items-center gap-1 text-[13.5px] text-ink-soft">
        {label}
        <ArrowUpRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </span>
      <span className="mt-0.5 block text-[26px] leading-tight font-bold tracking-[-0.02em] tabular-nums">
        {formatNumber(value)}
        <span className="ml-0.5 text-[15px] font-semibold text-ink-faint">{unit}</span>
      </span>
    </Link>
  );
}

/** 대시보드 첫 줄: 전체 이수율(가장 큰 숫자 하나)과 바로 가는 숫자들 */
function Headline({ data, reading }: { data: Dashboard; reading: number }) {
  const { overall, employees } = data;
  const shown = useCountUp(overall.rate === null ? 0 : Math.round(overall.rate * 100));
  return (
    <section className="grid gap-2 rounded-2xl border border-line bg-sheet p-2 shadow-surface lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="px-5 py-4">
        <p className="text-[14px] font-semibold text-ink-soft">전체 이수율</p>
        <p className="mt-1 text-[76px] leading-none font-extrabold tracking-[-0.05em] tabular-nums" aria-live="polite">
          {overall.rate === null ? '-' : shown}
          {overall.rate !== null && <span className="ml-1 text-[36px] font-bold tracking-[-0.02em] text-ink-faint">%</span>}
        </p>
        <Meter rate={overall.rate} label={`전체 이수율 ${percent(overall.rate)}`} className="mt-5" tall />
        <p className="mt-2.5 text-[13px] text-ink-faint">
          직원 × 교육 {formatNumber(overall.target)}건 중 {formatNumber(overall.done)}건 이수
          {overall.partial > 0 && `, 부분이수 ${formatNumber(overall.partial)}건`}. 확정한 이수증만 셉니다.
        </p>
      </div>
      <div className="grid grid-cols-2 content-center gap-1 rounded-xl bg-paper/60 p-2">
        <Figure label="모든 교육 이수" value={employees.complete} unit="명" to={`/status?year=${data.year}`} />
        <Figure label="남은 교육이 있는 직원" value={employees.missing} unit="명" to={`/status?year=${data.year}&missing=1`} />
        <Figure label="검수 대기" value={data.drafts} unit="건" to="/review" />
        <Figure label="읽는 중" value={reading} unit="쪽" to="/upload" />
      </div>
    </section>
  );
}

// ── 직원 지도: 직원 한 명이 칸 하나. 부서별 줄, 칸에 올리면 이름과 남은 교육 ─────────

type PersonState = 'complete' | 'partial' | 'none' | 'exempt';

const PERSON_LABELS: Record<PersonState, string> = {
  complete: '모든 교육 이수',
  partial: '일부 이수',
  none: '아직 이수 없음',
  exempt: '모든 교육 대상 제외',
};

// 이수 현황 표의 칸과 같은 모양 (StateMark)
const PERSON_CELL: Record<PersonState, string> = {
  complete: STATE_CELL.done,
  partial: STATE_CELL.partial,
  none: STATE_CELL.none,
  exempt: STATE_CELL.exempt,
};

interface Person {
  row: StatusRow;
  state: PersonState;
  missing: Training[];
}

function personOf(row: StatusRow, trainings: Training[]): Person {
  const target = trainings.filter((t) => row.cells[t.id] && row.cells[t.id].state !== 'exempt');
  const missing = target.filter((t) => row.cells[t.id].state !== 'done');
  const anyDone = target.some((t) => ['done', 'partial'].includes(row.cells[t.id].state));
  const state: PersonState = target.length === 0 ? 'exempt' : missing.length === 0 ? 'complete' : anyDone ? 'partial' : 'none';
  return { row, state, missing };
}

function EmployeeMap({ data }: { data: Dashboard }) {
  const navigate = useNavigate();
  const report = useQuery({ queryKey: ['status', data.year, null], queryFn: () => api.get<StatusReport>(`/status?year=${data.year}`) });
  const boxRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ person: Person; x: number; y: number } | null>(null);

  const groups = useMemo(() => {
    if (!report.data) return [];
    const people = report.data.rows.map((row) => personOf(row, report.data.trainings));
    return data.departments.map((d) => ({ department: d, people: people.filter((p) => p.row.departmentId === d.departmentId) }));
  }, [report.data, data.departments]);

  function show(person: Person, target: HTMLElement) {
    const box = boxRef.current!.getBoundingClientRect();
    const cell = target.getBoundingClientRect();
    setTip({ person, x: cell.left - box.left + cell.width / 2, y: cell.top - box.top });
  }

  let index = 0;
  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold">직원 지도</h2>
          <p className="mt-0.5 text-[14px] text-ink-soft">한 칸이 직원 한 명입니다. 칸에 마우스를 올리면 남은 교육이 보이고, 누르면 그 사람의 이수 현황으로 갑니다.</p>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-soft" aria-label="칸 모양 설명">
          {(['complete', 'partial', 'none', 'exempt'] as const).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cn('size-3.5 rounded-[4px]', PERSON_CELL[s])} aria-hidden />
              {PERSON_LABELS[s]}
            </li>
          ))}
        </ul>
      </div>

      <div ref={boxRef} className="relative mt-4 rounded-2xl border border-line bg-sheet px-2 py-2 shadow-surface" onMouseLeave={() => setTip(null)}>
        {report.isLoading && <LoadingRows rows={3} />}
        {groups.map(({ department: d, people }) => (
          <div key={d.departmentId ?? 'none'} className="grid items-center gap-x-6 gap-y-2 rounded-xl px-4 py-2.5 transition-colors hover:bg-paper/70 md:grid-cols-[160px_minmax(0,1fr)_96px]">
            <div className="min-w-0">
              <p className="truncate font-semibold">{d.name}</p>
              <p className="text-[12.5px] text-ink-faint tabular-nums">
                {formatNumber(d.employees)}명 · 이수율 {percent(d.rate)}
              </p>
            </div>
            <ul className="flex flex-wrap gap-[5px]" aria-label={`${d.name} 직원`}>
              {people.map((p) => {
                const i = index++;
                return (
                  <li key={p.row.employeeId}>
                    <button
                      type="button"
                      aria-label={`${p.row.name}: ${PERSON_LABELS[p.state]}${p.missing.length > 0 ? `, 남은 교육 ${p.missing.map((t) => shortTrainingName(t.name)).join(', ')}` : ''}`}
                      onMouseEnter={(e) => show(p, e.currentTarget)}
                      onFocus={(e) => show(p, e.currentTarget)}
                      onBlur={() => setTip(null)}
                      onClick={() =>
                        void navigate(`/status?year=${data.year}&q=${encodeURIComponent(p.row.name)}${d.departmentId ? `&departmentId=${d.departmentId}` : ''}`, {
                          viewTransition: true,
                        })
                      }
                      style={{ '--i': i } as React.CSSProperties}
                      className={cn(
                        'animate-cell-in block size-[18px] rounded-[5px] transition-transform duration-150 hover:scale-125 focus-visible:scale-125 focus-visible:outline-offset-1',
                        PERSON_CELL[p.state],
                      )}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="text-[13.5px] tabular-nums md:text-right">
              {d.missing > 0 && d.departmentId ? (
                <Link to={`/status?year=${data.year}&departmentId=${d.departmentId}&missing=1`} viewTransition className="font-medium text-ink-soft hover:text-link hover:underline">
                  남은 {formatNumber(d.missing)}명
                </Link>
              ) : d.missing > 0 ? (
                <span className="text-ink-soft">남은 {formatNumber(d.missing)}명</span>
              ) : (
                <span className="font-semibold text-ok">모두 이수</span>
              )}
            </div>
          </div>
        ))}

        {tip && (
          <div
            role="tooltip"
            className="animate-pop-in pointer-events-none absolute z-10 w-64 -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3.5 py-3 text-[13px] text-white shadow-float"
            style={{ left: tip.x, top: tip.y - 10 }}
          >
            <p className="text-[14.5px] font-bold">
              {tip.person.row.name}
              <span className="ml-1.5 text-[12.5px] font-medium text-white/60">{tip.person.row.departmentName ?? '부서 없음'}</span>
            </p>
            <p className="mt-0.5 text-white/75">{PERSON_LABELS[tip.person.state]}</p>
            {tip.person.missing.length > 0 && (
              <ul className="mt-2 space-y-0.5 border-t border-white/15 pt-2">
                {tip.person.missing.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3">
                    <span className="truncate">{shortTrainingName(t.name)}</span>
                    <span className="shrink-0 text-white/60">{COMPLETION_LABELS[tip.person.row.cells[t.id].state]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TrainingRates({ data }: { data: Dashboard }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[19px] font-bold">교육별 이수율</h2>
        <Link to={`/status?year=${data.year}`} viewTransition className="text-[14px] font-semibold text-link hover:underline">
          직원별로 보기
        </Link>
      </div>
      <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-sheet shadow-surface">
        {data.trainings.map((t) => {
          const s = data.summary.find((x) => x.trainingId === t.id)!;
          const detail = `이수 ${s.done} · 부분이수 ${s.partial} · 미이수 ${s.none}${s.exempt ? ` · 제외 ${s.exempt}` : ''}`;
          return (
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,260px)_52px_88px] items-center gap-5 px-6 py-3.5" title={`${t.name}: ${detail}`}>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{t.name}</span>
                <span className="block text-[13px] text-ink-faint">{requirementText(t.reqType, t.reqValue)}</span>
              </span>
              <Meter rate={s.rate} label={`${t.name} 이수율 ${percent(s.rate)} (${detail})`} />
              <span className="text-right text-[16px] font-bold tabular-nums">{percent(s.rate)}</span>
              <span className="text-right text-[13.5px] text-ink-soft tabular-nums">
                {formatNumber(s.done)} / {formatNumber(s.target)}명
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AdminChecklist({ overview }: { overview: Overview }) {
  const steps = [
    { title: '기관 정보와 관리자 계정 만들기', done: true, to: '/settings?tab=org', action: '기관 정보 보기' },
    {
      title: '인사 명단으로 직원 등록하기',
      done: overview.employees > 0,
      to: '/employees/import',
      action: '명단 올리기',
      detail: '부서는 명단에 적힌 대로 함께 만들어집니다.',
    },
    {
      title: '부서별 서무 계정 만들기',
      done: overview.clerks > 0,
      to: '/settings?tab=users',
      action: '계정 만들기',
      detail: '서무는 담당 부서의 직원과 이수증만 봅니다.',
    },
    {
      title: '교육 과정 기준 확인하기',
      done: trainingsReviewed(),
      to: '/trainings',
      action: '교육 과정 보기',
      detail: '공공기관 기본 목록이 들어 있습니다. 기관 지침과 다르면 고쳐 주세요.',
    },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="mt-8">
      <h2 className="text-[19px] font-bold">시작 준비</h2>
      <ol className="mt-4 divide-y divide-line rounded-2xl border border-line bg-sheet shadow-surface">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-center gap-4 px-6 py-4">
            <span className="w-5 text-[13px] font-semibold text-ink-faint tabular-nums">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', step.done && 'text-ink-soft')}>{step.title}</p>
              {step.detail && !step.done && <p className="mt-0.5 text-[13px] text-ink-faint">{step.detail}</p>}
            </div>
            {step.done ? (
              <ConfirmStamp className="size-10 text-[12px]" />
            ) : (
              <Link to={step.to} viewTransition className={buttonClass('secondary', 'sm')}>
                {step.action}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ClerkDepartments() {
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => api.get<Department[]>('/departments'),
  });
  if (departments.length > 0) return null;
  return (
    <p className="mt-8 rounded-xl border border-warn/30 bg-warn-soft px-5 py-3.5 text-[14.5px]">
      아직 담당 부서가 없습니다. 교육 담당 관리자에게 부서 지정을 요청하세요.
    </p>
  );
}

export function HomePage() {
  const me = useCurrentUser();
  const { data: meta } = useMeta();
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/overview') });
  const dashboard = useQuery({ queryKey: ['dashboard', year], queryFn: () => api.get<Dashboard>(`/dashboard?year=${year}`) });
  const processing = useProcessing();
  const reading = (processing.data?.waiting ?? 0) + (processing.data?.running ?? 0);
  const data = dashboard.data;

  return (
    <>
      <PageHeader
        title={`${year}년 법정교육 이수 현황`}
        description={`${meta?.orgName ?? ''} ${me.role === 'admin' ? '전체' : '담당 부서'} 직원의 이수 현황입니다. 이수증을 검수해서 확정하면 바로 반영됩니다.`}
        actions={
          <>
            <Select className="w-32" value={year} onChange={(e) => setParams({ year: e.target.value }, { replace: true })} aria-label="연도">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </Select>
            <Link to="/upload" viewTransition className={buttonClass('primary')}>
              이수증 올리기
            </Link>
          </>
        }
      />
      {data && data.employees.total > 0 ? (
        <>
          <Headline key={year} data={data} reading={reading} />
          <EmployeeMap key={`map-${year}`} data={data} />
          <TrainingRates data={data} />
        </>
      ) : (
        data && (
          <EmptyState
            title="이수율을 계산할 직원이 없습니다"
            description={me.role === 'admin' ? '인사 명단으로 직원을 등록하면 교육별·부서별 이수율이 여기에 나옵니다.' : '담당 부서에 직원이 등록되면 이수율이 여기에 나옵니다.'}
          />
        )
      )}
      {overview && me.role === 'admin' && <AdminChecklist overview={overview} />}
      {me.role === 'clerk' && <ClerkDepartments />}
    </>
  );
}
