import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StatusReport } from '../../../shared/types.ts';
import { currentUser, departmentScope, requireUser } from '../auth/guard.ts';
import { loadTrainings } from '../certs/review.ts';
import { applicableTrainings, computeStatus } from '../certs/status.ts';
import type { Deps } from '../deps.ts';

const StatusQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  departmentId: z.coerce.number().int().positive().optional(),
});

export async function statusRoutes(app: FastifyInstance, { db }: Deps) {
  // 이수 현황: 연도별 직원 × 교육 판정. 서무는 담당 부서 직원만
  app.get('/api/status', { preHandler: requireUser }, async (req): Promise<StatusReport> => {
    const { year, departmentId } = StatusQuery.parse(req.query);
    const scope = departmentScope(currentUser(req));
    const trainings = applicableTrainings(await loadTrainings(db), year);
    if (scope && scope.length === 0) return { year, trainings, rows: [], summary: [] };

    const employees = await db
      .selectFrom('employees as e')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .select(['e.id', 'e.emp_no', 'e.name', 'd.name as department_name', 'e.status'])
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
          .select(['c.employee_id', 'ct.training_id', 'c.id as certificate_id', 'ct.credited_hours', 'c.hours'])
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
      employees: employees.map((e) => ({ id: e.id, empNo: e.emp_no, name: e.name, departmentName: e.department_name, status: e.status })),
      credits: credits.map((c) => ({
        employeeId: c.employee_id!,
        trainingId: c.training_id,
        certificateId: c.certificate_id,
        creditedHours: c.credited_hours,
      })),
      exemptions: exemptions.map((x) => ({ employeeId: x.employee_id, trainingId: x.training_id, reason: x.reason })),
    });
  });
}
