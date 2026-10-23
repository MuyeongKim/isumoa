import type { Kysely } from 'kysely';
import type { Dashboard, DashboardDepartment, StatusReport } from '../../../shared/types.ts';
import { loadTrainings } from '../certs/review.ts';
import { applicableTrainings, computeStatus } from '../certs/status.ts';
import type { DB } from '../db/schema.ts';

// 이수 현황 계산을 한곳에 모았다. 이수 현황 화면·대시보드·엑셀이 같은 숫자를 쓴다.

export interface ReportScope {
  year: number;
  /** 다룰 수 있는 부서 (관리자는 null = 전체) */
  scope: number[] | null;
  /** 한 부서만 볼 때 */
  departmentId?: number;
}

/** 연도별 직원 × 교육 판정. 서무는 담당 부서 직원만 */
export async function loadStatusReport(db: Kysely<DB>, { year, scope, departmentId }: ReportScope): Promise<StatusReport> {
  const trainings = applicableTrainings(await loadTrainings(db), year);
  if (scope && scope.length === 0) return { year, trainings, rows: [], summary: [] };

  const employees = await db
    .selectFrom('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(['e.id', 'e.emp_no', 'e.name', 'e.department_id', 'd.name as department_name', 'e.status'])
    .$if(scope !== null, (qb) => qb.where('e.department_id', 'in', scope!))
    .$if(departmentId !== undefined, (qb) => qb.where('e.department_id', '=', departmentId!))
    .orderBy('d.sort_order')
    .orderBy('d.name')
    .orderBy('e.name')
    .execute();
  const ids = employees.map((e) => e.id);

  const credits = ids.length
    ? await db
        .selectFrom('certificate_trainings as ct')
        .innerJoin('certificates as c', 'c.id', 'ct.certificate_id')
        .select(['c.employee_id', 'ct.training_id', 'c.id as certificate_id', 'ct.credited_hours'])
        .where('c.status', '=', 'confirmed')
        .where('c.year', '=', year)
        .where('c.employee_id', 'in', ids)
        .execute()
    : [];
  const exemptions = ids.length
    ? await db
        .selectFrom('exemptions')
        .select(['employee_id', 'training_id', 'reason'])
        .where('year', '=', year)
        .where('employee_id', 'in', ids)
        .execute()
    : [];

  return computeStatus({
    year,
    trainings,
    employees: employees.map((e) => ({
      id: e.id,
      empNo: e.emp_no,
      name: e.name,
      departmentId: e.department_id,
      departmentName: e.department_name,
      status: e.status,
    })),
    credits: credits.map((c) => ({
      employeeId: c.employee_id!,
      trainingId: c.training_id,
      certificateId: c.certificate_id,
      creditedHours: c.credited_hours,
    })),
    exemptions: exemptions.map((x) => ({ employeeId: x.employee_id, trainingId: x.training_id, reason: x.reason })),
  });
}

/**
 * 대시보드 숫자. 이수율은 "직원 × 교육" 칸 단위로 센다 (대상 제외 칸은 뺀다).
 * 직원 단위로는 모든 교육을 마친 사람과 하나라도 남은 사람을 센다 (모든 교육이 대상 제외인 직원은 빼고).
 */
export function summarizeDashboard(report: StatusReport, drafts: number): Dashboard {
  const tally = (rows: StatusReport['rows']) => {
    let target = 0;
    let done = 0;
    let partial = 0;
    let complete = 0;
    let missing = 0;
    for (const row of rows) {
      const cells = report.trainings.map((t) => row.cells[t.id]).filter((c) => c.state !== 'exempt');
      target += cells.length;
      done += cells.filter((c) => c.state === 'done').length;
      partial += cells.filter((c) => c.state === 'partial').length;
      // 모든 교육이 대상 제외인 직원(휴직·파견 등)은 이수·미이수 어느 쪽에도 세지 않는다
      if (cells.length === 0) continue;
      if (cells.every((c) => c.state === 'done')) complete++;
      else missing++;
    }
    return { target, done, partial, complete, missing, rate: target > 0 ? done / target : null };
  };

  const all = tally(report.rows);
  // 부서 순서는 이수 현황과 같게 (직원 목록이 부서 순서로 정렬되어 온다)
  const groups = new Map<number | null, { name: string; rows: StatusReport['rows'] }>();
  for (const row of report.rows) {
    const group = groups.get(row.departmentId) ?? { name: row.departmentName ?? '부서 없음', rows: [] };
    group.rows.push(row);
    groups.set(row.departmentId, group);
  }
  const departments: DashboardDepartment[] = [...groups].map(([departmentId, g]) => {
    const t = tally(g.rows);
    return { departmentId, name: g.name, employees: g.rows.length, complete: t.complete, missing: t.missing, rate: t.rate };
  });

  return {
    year: report.year,
    overall: { target: all.target, done: all.done, partial: all.partial, rate: all.rate },
    employees: { total: all.complete + all.missing, complete: all.complete, missing: all.missing },
    drafts,
    trainings: report.trainings,
    summary: report.summary,
    departments,
  };
}
