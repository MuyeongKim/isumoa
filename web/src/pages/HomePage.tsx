import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { Department, Overview } from '@shared/types.ts';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmStamp } from '@/components/SealMark';
import { api } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { useCurrentUser, useMeta } from '@/lib/session';

export const TRAININGS_REVIEWED_KEY = 'ecp.trainingsReviewed';

function trainingsReviewed(): boolean {
  try {
    return localStorage.getItem(TRAININGS_REVIEWED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 공문서 현황표처럼 한 줄로 보여 주는 요약 */
function SummaryTable({ overview, isAdmin }: { overview: Overview; isAdmin: boolean }) {
  const cells = [
    { label: isAdmin ? '부서' : '담당 부서', value: overview.departments },
    { label: '재직 직원', value: overview.employees },
    { label: '사용 중인 교육', value: overview.activeTrainings },
    ...(isAdmin ? [{ label: '서무 계정', value: overview.clerks }] : []),
  ];
  return (
    <table className="w-full border-collapse overflow-hidden rounded-md border border-line bg-sheet text-center">
      <thead>
        <tr>
          {cells.map((c) => (
            <th key={c.label} className="border border-line bg-navy-soft/70 px-3 py-2 text-[12.5px] font-semibold text-ink-soft">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {cells.map((c) => (
            <td key={c.label} className="border border-line px-3 py-4 text-[22px] font-semibold tabular-nums">
              {formatNumber(c.value)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
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
  return (
    <section className="mt-8">
      <h2 className="text-[16px] font-semibold">담당 부서</h2>
      {departments.length === 0 ? (
        <p className="mt-3 text-ink-soft">아직 담당 부서가 없습니다. 교육 담당 관리자에게 부서 지정을 요청하세요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-sheet">
          {departments.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-5 py-3">
              <span className="font-medium">{d.name}</span>
              <Link to={`/employees?departmentId=${d.id}`} className="text-[13.5px] text-link hover:underline">
                직원 {formatNumber(d.employeeCount)}명 보기
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-ink-faint">
        이수증 올리기와 검수는 다음 단계에서 열립니다. 그 전에 담당 부서 직원 명단이 맞는지 확인해 주세요.
      </p>
    </section>
  );
}

export function HomePage() {
  const me = useCurrentUser();
  const { data: meta } = useMeta();
  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/overview') });
  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader
        title={`${year}년 법정교육`}
        description={`${meta?.orgName ?? ''} 법정교육 이수증을 모으고 확인하는 곳입니다. 이수증을 올리고 검수하면 교육별·부서별 이수율이 이 화면에 모입니다.`}
      />
      {overview && <SummaryTable overview={overview} isAdmin={me.role === 'admin'} />}
      {overview && me.role === 'admin' && <AdminChecklist overview={overview} />}
      {me.role === 'clerk' && <ClerkDepartments />}
    </>
  );
}
