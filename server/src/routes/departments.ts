import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Department } from '../../../shared/types.ts';
import { currentUser, departmentScope, requireAdmin, requireUser } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { HttpError, notFound } from '../lib/errors.ts';
import { RosterSelection, trashRoster } from '../roster/trash.ts';

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
      .select(['id', 'deleted_at'])
      .where('name', '=', name)
      .$if(exceptId !== undefined, (qb) => qb.where('id', '!=', exceptId!))
      .executeTakeFirst();
    if (same) throw new HttpError(409, same.deleted_at ? '같은 이름의 부서가 휴지통에 있습니다. 삭제한 부서 보기에서 먼저 복원해 주세요.' : '같은 이름의 부서가 이미 있습니다.');
  }

  app.get('/api/departments', { preHandler: requireUser }, async (req): Promise<Department[]> => {
    const { trash } = z.object({ trash: z.enum(['1']).optional() }).parse(req.query);
    if (trash && currentUser(req).role !== 'admin') throw new HttpError(403, '휴지통은 관리자만 볼 수 있습니다.');
    const scope = departmentScope(currentUser(req));
    if (scope && scope.length === 0) return [];
    const rows = await db
      .selectFrom('departments as d')
      .select((eb) => [
        'd.id',
        'd.name',
        'd.sort_order',
        'd.active',
        'd.deleted_at',
        eb.selectFrom('employees as m').select(eb.fn.countAll<number>().as('n'))
          .whereRef('m.department_id', '=', 'd.id').where('m.deleted_at', 'is', null).as('member_count'),
        eb
          .selectFrom('employees as e')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('e.department_id', '=', 'd.id')
          .where('e.status', '!=', 'retired')
          .where('e.deleted_at', 'is', null)
          .as('employee_count'),
        eb
          .selectFrom('user_departments as ud')
          .innerJoin('users as u', 'u.id', 'ud.user_id')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('ud.department_id', '=', 'd.id')
          .where('u.active', '=', 1)
          .as('clerk_count'),
      ])
      .where('d.deleted_at', trash ? 'is not' : 'is', null)
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
      memberCount: Number(r.member_count ?? 0),
      deletedAt: r.deleted_at,
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
    const before = await db.selectFrom('departments').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
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

  for (const restore of [false, true]) {
    app.post(`/api/departments/bulk-${restore ? 'restore' : 'delete'}`, { preHandler: requireAdmin }, async req => {
      const { ids } = RosterSelection.parse(req.body);
      const result = await trashRoster(db, 'departments', ids, restore);
      await audit(db, req, restore ? 'department.restore' : 'department.bulk-delete', undefined, { ids, ...result });
      return result;
    });
  }

  app.delete('/api/departments/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const result = await trashRoster(db, 'departments', [id]);
    await audit(db, req, 'department.delete', { type: 'department', id }, { ...result });
    return { ok: true };
  });
}
