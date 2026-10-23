import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import type { Dashboard, Department, Overview } from '@shared/types.ts';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { useProcessing } from '@/components/ProcessingBanner';
import { ConfirmStamp } from '@/components/SealMark';
import { Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn, formatNumber, requirementText } from '@/lib/format';
import { useCurrentUser, useMeta } from '@/lib/session';

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

/** 비율 막대: 채운 부분과 같은 색의 옅은 바탕 (색이 아니라 길이와 숫자로 읽는다) */
function Meter({ rate, label, className }: { rate: number | null; label: string; className?: string }) {
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rate === null ? undefined : Math.round(rate * 100)}
      title={label}
      className={cn('block h-2 overflow-hidden rounded-full bg-ok-soft', className)}
    >
      <span className="block h-full rounded-full bg-ok" style={{ width: `${(rate ?? 0) * 100}%` }} />
    </span>
  );
}

function StatTile({ label, value, unit, detail, to }: { label: string; value: number; unit: string; detail?: string; to?: string }) {
  const body = (
    <>
      <p className="text-[13px] text-ink-soft">{label}</p>
      <p className="mt-1 text-[26px] leading-tight font-semibold">
        {formatNumber(value)}
        <span className="ml-0.5 text-[15px] font-medium text-ink-soft">{unit}</span>
      </p>
      {detail && <p className="mt-1 text-[12.5px] text-ink-faint">{detail}</p>}
    </>
  );
  const box = 'block rounded-md border border-line bg-sheet px-4 py-3.5';
  return to ? (
    <Link to={to} className={cn(box, 'transition-colors hover:border-line-strong')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** 대시보드 첫 줄: 전체 이수율(가장 큰 숫자 하나)과 주요 숫자들 */
function Headline({ data, reading }: { data: Dashboard; reading: number }) {
  const { overall, employees } = data;
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
      <div className="rounded-md border border-line bg-sheet px-5 py-4">
        <p className="text-[13px] text-ink-soft">전체 이수율</p>
        <p className="mt-1 text-[52px] leading-none font-semibold">{percent(overall.rate)}</p>
        <Meter rate={overall.rate} label={`전체 이수율 ${percent(overall.rate)}`} className="mt-4" />
        <p className="mt-2 text-[12.5px] text-ink-faint">
          직원 × 교육 {formatNumber(overall.target)}건 중 {formatNumber(overall.done)}건 이수
          {overall.partial > 0 && ` · 부분이수 ${formatNumber(overall.partial)}건`} (확정한 이수증 기준, 대상 제외 빼고)
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
        <StatTile label="모든 교육 이수" value={employees.complete} unit="명" detail={`교육 대상 ${formatNumber(employees.total)}명 중`} to={`/status?year=${data.year}`} />
        <StatTile label="남은 교육이 있는 직원" value={employees.missing} unit="명" detail="미이수·부분이수" to={`/status?year=${data.year}&missing=1`} />
        <StatTile label="검수 대기" value={data.drafts} unit="건" detail="확정해야 이수율에 반영" to="/review" />
        <StatTile label="읽는 중" value={reading} unit="쪽" detail="올린 이수증 처리" to="/upload" />
      </div>
    </section>
  );
}

function TrainingRates({ data }: { data: Dashboard }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold">교육별 이수율</h2>
        <Link to={`/status?year=${data.year}`} className="text-[13.5px] text-link hover:underline">
          직원별로 보기
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-sheet">
        {data.trainings.map((t) => {
          const s = data.summary.find((x) => x.trainingId === t.id)!;
          const detail = `이수 ${s.done} · 부분이수 ${s.partial} · 미이수 ${s.none}${s.exempt ? ` · 제외 ${s.exempt}` : ''}`;
          return (
            <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_minmax(100px,240px)_48px_84px] items-center gap-4 px-5 py-2.5" title={`${t.name}: ${detail}`}>
              <span className="min-w-0">
                <span className="block truncate font-medium">{t.name}</span>
                <span className="block text-[12px] text-ink-faint">{requirementText(t.reqType, t.reqValue)}</span>
              </span>
              <Meter rate={s.rate} label={`${t.name} 이수율 ${percent(s.rate)} (${detail})`} />
              <span className="text-right font-semibold tabular-nums">{percent(s.rate)}</span>
              <span className="text-right text-[13px] text-ink-soft tabular-nums">
                {formatNumber(s.done)} / {formatNumber(s.target)}명
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DepartmentRates({ data }: { data: Dashboard }) {
  if (data.departments.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-[16px] font-semibold">부서별 이수율</h2>
      <div className="mt-3 overflow-x-auto rounded-md border border-line bg-sheet">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="text-left text-[12.5px] text-ink-soft">
              <th className="border-b border-line bg-navy-soft/70 px-5 py-2 font-semibold">부서</th>
              <th className="w-20 border-b border-line bg-navy-soft/70 px-3 py-2 text-right font-semibold">직원</th>
              <th className="border-b border-line bg-navy-soft/70 px-3 py-2 font-semibold">이수율</th>
              <th className="w-24 border-b border-line bg-navy-soft/70 px-3 py-2 text-right font-semibold">모두 이수</th>
              <th className="w-28 border-b border-line bg-navy-soft/70 px-3 py-2 text-right font-semibold">남은 직원</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.departments.map((d) => (
              <tr key={d.departmentId ?? 'none'} className="border-b border-line last:border-b-0 hover:bg-paper">
                <td className="px-5 py-2 font-medium">
                  {d.departmentId ? (
                    <Link to={`/status?year=${data.year}&departmentId=${d.departmentId}`} className="hover:text-link hover:underline">
                      {d.name}
                    </Link>
                  ) : (
                    d.name
                  )}
                </td>
                <td className="px-3 py-2 text-right">{formatNumber(d.employees)}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-3">
                    <Meter rate={d.rate} label={`${d.name} 이수율 ${percent(d.rate)}`} className="w-full max-w-60" />
                    <span className="w-10 text-right font-semibold">{percent(d.rate)}</span>
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{formatNumber(d.complete)}</td>
                <td className="px-3 py-2 text-right">
                  {d.missing > 0 && d.departmentId ? (
                    <Link to={`/status?year=${data.year}&departmentId=${d.departmentId}&missing=1`} className="text-link hover:underline">
                      {formatNumber(d.missing)}명
                    </Link>
                  ) : (
                    `${formatNumber(d.missing)}명`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
      <h2 className="text-[16px] font-semibold">시작 준비</h2>
      <ol className="mt-3 divide-y divide-line rounded-md border border-line bg-sheet">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-center gap-4 px-5 py-4">
            <span className="w-5 text-[13px] font-semibold text-ink-faint tabular-nums">{index + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', step.done && 'text-ink-soft')}>{step.title}</p>
              {step.detail && !step.done && <p className="mt-0.5 text-[13px] text-ink-faint">{step.detail}</p>}
            </div>
            {step.done ? (
              <ConfirmStamp className="size-10 text-[12px]" />
            ) : (
              <Link to={step.to} className="text-[13.5px] font-medium text-link hover:underline">
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
    <p className="mt-8 rounded-md border border-warn/40 bg-warn-soft px-5 py-3 text-[14px]">
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
        title={`${year}년 법정교육`}
        description={`${meta?.orgName ?? ''} ${me.role === 'admin' ? '전체' : '담당 부서'}의 법정교육 이수 현황입니다. 이수증을 검수해서 확정하면 바로 반영됩니다.`}
        actions={
          <>
            <Select className="w-32" value={year} onChange={(e) => setParams({ year: e.target.value }, { replace: true })} aria-label="연도">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </Select>
            <Link to="/upload" className="inline-flex h-9 items-center rounded-md bg-navy px-4 text-[14px] font-medium text-white hover:bg-navy-hover">
              이수증 올리기
            </Link>
          </>
        }
      />
      {data && data.employees.total > 0 ? (
        <>
          <Headline data={data} reading={reading} />
          <TrainingRates data={data} />
          <DepartmentRates data={data} />
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
