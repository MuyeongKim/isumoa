import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Overview } from '../../../shared/types.ts';
import { currentUser, departmentScope, requireAdmin, requireUser } from '../auth/guard.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';

const OrgBody = z.object({ name: z.string().trim().min(1, '기관명을 입력해 주세요.').max(100) });

export async function overviewRoutes(app: FastifyInstance, { db }: Deps) {
  // 첫 화면 숫자: 서무는 담당 부서 기준으로 센다
  app.get('/api/overview', { preHandler: requireUser }, async (req): Promise<Overview> => {
    const scope = departmentScope(currentUser(req));
    const none = scope !== null && scope.length === 0;

    const departments = await db
      .selectFrom('departments')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('active', '=', 1)
      .$if(scope !== null, (qb) => qb.where('id', 'in', none ? [-1] : scope!))
      .executeTakeFirstOrThrow();
    const employees = await db
      .selectFrom('employees')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('status', '!=', 'retired')
      .$if(scope !== null, (qb) => qb.where('department_id', 'in', none ? [-1] : scope!))
      .executeTakeFirstOrThrow();
    const trainings = await db
      .selectFrom('trainings')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('active', '=', 1)
      .executeTakeFirstOrThrow();
    const clerks = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('role', '=', 'clerk')
      .where('active', '=', 1)
      .executeTakeFirstOrThrow();

    return { departments: departments.n, employees: employees.n, activeTrainings: trainings.n, clerks: clerks.n };
  });

  app.get('/api/settings/org', { preHandler: requireAdmin }, async () => getSetting(db, 'org', { name: '' }));

  app.put('/api/settings/org', { preHandler: requireAdmin }, async (req) => {
    const body = OrgBody.parse(req.body);
    await setSetting(db, 'org', { name: body.name });
    await audit(db, req, 'settings.org', undefined, { name: body.name });
    return { ok: true };
  });
}
