import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Dashboard, SessionUser, StatusReport } from '../../../shared/types.ts';
import { currentUser, departmentScope, requireUser } from '../auth/guard.ts';
import type { DB } from '../db/schema.ts';
import type { Deps } from '../deps.ts';
import { loadStatusReport, summarizeDashboard } from '../reports/statusReport.ts';

const StatusQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  departmentId: z.coerce.number().int().positive().optional(),
});

/** 그해 검수 대기 이수증 수. 서무는 자기가 올렸거나 담당 부서 직원의 것 */
export async function countDrafts(db: Kysely<DB>, user: SessionUser, year: number, departmentId?: number): Promise<number> {
  const scope = departmentScope(user);
  const row = await db
    .selectFrom('certificates as c')
    .innerJoin('batches as b', 'b.id', 'c.batch_id')
    .leftJoin('employees as e', 'e.id', 'c.employee_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('c.status', '=', 'draft')
    .where((eb) => eb(eb.fn.coalesce('c.year', 'b.year'), '=', year))
    .$if(scope !== null, (qb) =>
      qb.where((eb) => eb.or([eb('b.created_by', '=', user.id), eb('e.department_id', 'in', scope!.length ? scope! : [-1])])),
    )
    .$if(departmentId !== undefined, (qb) => qb.where('e.department_id', '=', departmentId!))
    .executeTakeFirstOrThrow();
  return Number(row.n);
}

export async function statusRoutes(app: FastifyInstance, { db }: Deps) {
  // 이수 현황: 연도별 직원 × 교육 판정. 서무는 담당 부서 직원만
  app.get('/api/status', { preHandler: requireUser }, async (req): Promise<StatusReport> => {
    const { year, departmentId } = StatusQuery.parse(req.query);
    return loadStatusReport(db, { year, scope: departmentScope(currentUser(req)), departmentId });
  });

  // 대시보드: 전체·교육별·부서별 이수율과 검수 대기
  app.get('/api/dashboard', { preHandler: requireUser }, async (req): Promise<Dashboard> => {
    const { year } = StatusQuery.parse(req.query);
    const user = currentUser(req);
    const report = await loadStatusReport(db, { year, scope: departmentScope(user) });
    return summarizeDashboard(report, await countDrafts(db, user, year));
  });
}
