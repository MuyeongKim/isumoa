import type {
  EmployeeStatus,
  StatusCell,
  StatusReport,
  StatusRow,
  StatusTrainingSummary,
  Training,
} from '../../../shared/types.ts';

// 이수 판정: 연도별로 직원 × 교육마다 확정된 이수증을 모아
//   시간 기준(연 N시간) → 인정 시간 합계, 횟수 기준(연 N회) → 이수증 수로 판단한다.
// DB를 건드리지 않는 순수 함수라 테스트하기 쉽다.

export interface StatusEmployee {
  id: number;
  empNo: string | null;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  status: EmployeeStatus;
}

export interface StatusCredit {
  employeeId: number;
  trainingId: number;
  certificateId: number;
  creditedHours: number | null;
}

export interface StatusExemption {
  employeeId: number;
  /** null이면 모든 교육 */
  trainingId: number | null;
  reason: string;
}

const AUTO_EXEMPT: Partial<Record<EmployeeStatus, string>> = { leave: '휴직', dispatched: '파견' };

/** 그해에 적용되는 사용 중인 교육 */
export function applicableTrainings(trainings: Training[], year: number): Training[] {
  return trainings.filter((t) => t.active && (t.fromYear ?? 0) <= year && year <= (t.toYear ?? 9999));
}

function judge(training: Training, hours: number, count: number, unknownHours: boolean): Pick<StatusCell, 'state' | 'note'> {
  if (training.reqType === 'count') {
    if (count >= training.reqValue) return { state: 'done', note: null };
    return count > 0 ? { state: 'partial', note: `${count}회 / 연 ${training.reqValue}회` } : { state: 'none', note: null };
  }
  if (hours >= training.reqValue) return { state: 'done', note: null };
  if (count === 0) return { state: 'none', note: null };
  return { state: 'partial', note: unknownHours ? '교육시간 미기재 이수증 있음' : `${hours}시간 / 연 ${training.reqValue}시간` };
}

export function computeStatus(input: {
  year: number;
  trainings: Training[];
  employees: StatusEmployee[];
  credits: StatusCredit[];
  exemptions: StatusExemption[];
}): StatusReport {
  const creditMap = new Map<string, StatusCredit[]>();
  for (const c of input.credits) {
    const key = `${c.employeeId}:${c.trainingId}`;
    creditMap.set(key, [...(creditMap.get(key) ?? []), c]);
  }

  const rows: StatusRow[] = input.employees
    .filter((e) => e.status !== 'retired')
    .map((e) => {
      const cells: Record<number, StatusCell> = {};
      for (const t of input.trainings) {
        const credits = creditMap.get(`${e.id}:${t.id}`) ?? [];
        const hours = Math.round(credits.reduce((sum, c) => sum + (c.creditedHours ?? 0), 0) * 100) / 100;
        const base = { hours, count: credits.length, certificateIds: credits.map((c) => c.certificateId) };
        const exemption =
          AUTO_EXEMPT[e.status] ??
          input.exemptions.find((x) => x.employeeId === e.id && (x.trainingId === null || x.trainingId === t.id))?.reason;
        cells[t.id] = exemption
          ? { ...base, state: 'exempt', note: exemption }
          : { ...base, ...judge(t, hours, credits.length, credits.some((c) => c.creditedHours === null)) };
      }
      return { employeeId: e.id, empNo: e.empNo, name: e.name, departmentId: e.departmentId, departmentName: e.departmentName, cells };
    });

  const summary: StatusTrainingSummary[] = input.trainings.map((t) => {
    const count = (state: StatusCell['state']) => rows.filter((r) => r.cells[t.id].state === state).length;
    const exempt = count('exempt');
    const target = rows.length - exempt;
    const done = count('done');
    return {
      trainingId: t.id,
      target,
      done,
      partial: count('partial'),
      none: count('none'),
      exempt,
      rate: target > 0 ? done / target : null,
    };
  });

  return { year: input.year, trainings: input.trainings, rows, summary };
}
