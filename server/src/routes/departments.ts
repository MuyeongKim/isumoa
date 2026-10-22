import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Department } from '../../../shared/types.ts';
import { currentUser, departmentScope, requireAdmin, requireUser } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { HttpError, notFound } from '../lib/errors.ts';

const DepartmentBody = z.object({
  name: z.string().trim().min(1, '부서 이름을 입력해 주세요.').max(100),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export async function departmentRoutes(app: FastifyInstance, { db }: Deps) {
  async function ensureUniqueName(name: string, exceptId?: number) {
    const same = await db
      .selectFrom('departments')
      .select('id')
      .where('name', '=', name)
      .$if(exceptId !== undefined, (qb) => qb.where('id', '!=', exceptId!))
      .executeTakeFirst();
    if (same) throw new HttpError(409, '같은 이름의 부서가 이미 있습니다.');
  }

  app.get('/api/departments', { preHandler: requireUser }, async (req): Promise<Department[]> => {
    const scope = departmentScope(currentUser(req));
    if (scope && scope.length === 0) return [];
    const rows = await db
      .selectFrom('departments as d')
      .select((eb) => [
        'd.id',
        'd.name',
        'd.sort_order',
        'd.active',
        eb
          .selectFrom('employees as e')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('e.department_id', '=', 'd.id')
          .where('e.status', '!=', 'retired')
          .as('employee_count'),
        eb
          .selectFrom('user_departments as ud')
          .innerJoin('users as u', 'u.id', 'ud.user_id')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('ud.department_id', '=', 'd.id')
          .where('u.active', '=', 1)
          .as('clerk_count'),
      ])
      .$if(scope !== null, (qb) => qb.where('d.id', 'in', scope!))
      .orderBy('d.sort_order')
      .orderBy('d.name')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sortOrder: r.sort_order,
      active: r.active === 1,
      employeeCount: Number(r.employee_count ?? 0),
      clerkCount: Number(r.clerk_count ?? 0),
    }));
  });

  app.post('/api/departments', { preHandler: requireAdmin }, async (req) => {
    const body = DepartmentBody.parse(req.body);
    await ensureUniqueName(body.name);
    const maxOrder = await db
      .selectFrom('departments')
      .select((eb) => eb.fn.max('sort_order').as('max'))
      .executeTakeFirst();
    const created = await db
      .insertInto('departments')
      .values({
        name: body.name,
        sort_order: body.sortOrder ?? Number(maxOrder?.max ?? 0) + 10,
        active: body.active === false ? 0 : 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(db, req, 'department.create', { type: 'department', id: created.id }, { name: body.name });
    return { id: created.id };
  });

  app.patch('/api/departments/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = DepartmentBody.partial().parse(req.body);
    const before = await db.selectFrom('departments').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('부서를 찾을 수 없습니다.');
    if (body.name !== undefined && body.name !== before.name) await ensureUniqueName(body.name, id);

    await db
      .updateTable('departments')
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active ? 1 : 0 } : {}),
      })
      .where('id', '=', id)
      .execute();
    await audit(db, req, 'department.update', { type: 'department', id }, body);
    return { ok: true };
  });

  // 직원이나 서무가 연결된 부서는 지우지 않고 '사용 안 함'으로 바꾸게 한다
  app.delete('/api/departments/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const employee = await db.selectFrom('employees').select('id').where('department_id', '=', id).executeTakeFirst();
    const clerk = await db.selectFrom('user_departments').select('user_id').where('department_id', '=', id).executeTakeFirst();
    if (employee || clerk) {
      throw new HttpError(409, '직원이나 서무 계정이 연결된 부서는 삭제할 수 없습니다. 대신 "사용 안 함"으로 바꿔 주세요.');
    }
    const result = await db.deleteFrom('departments').where('id', '=', id).executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw notFound('부서를 찾을 수 없습니다.');
    await audit(db, req, 'department.delete', { type: 'department', id });
    return { ok: true };
  });
}
