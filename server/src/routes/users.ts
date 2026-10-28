import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { ROLES, type UserAccount } from '../../../shared/types.ts';
import { currentUser, requireAdmin } from '../auth/guard.ts';
import { checkPasswordPolicy, hashPassword } from '../auth/password.ts';
import { destroyUserSessions } from '../auth/sessions.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';

const CreateUserBody = z.object({
  loginId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{3,30}$/, '아이디는 영문·숫자·._- 조합 3~30자로 정해 주세요.'),
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  role: z.enum(ROLES),
  password: z.string().min(1, '처음 비밀번호를 입력해 주세요.').max(200),
  departmentIds: z.array(z.number().int().positive()).default([]),
});

const UpdateUserBody = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
});

const ResetPasswordBody = z.object({ password: z.string().min(1).max(200) });
const IdParams = z.object({ id: z.coerce.number().int().positive() });

async function assertDepartmentsExist(db: Kysely<DB>, ids: number[]) {
  if (ids.length === 0) return;
  const found = await db.selectFrom('departments').select('id').where('id', 'in', ids).where('deleted_at', 'is', null).execute();
  if (found.length !== new Set(ids).size) throw badRequest('없는 부서가 포함되어 있습니다.');
}

async function activeAdminCount(db: Kysely<DB>): Promise<number> {
  const row = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('role', '=', 'admin')
    .where('active', '=', 1)
    .executeTakeFirstOrThrow();
  return row.count;
}

export async function userRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/api/users', { preHandler: requireAdmin }, async (): Promise<UserAccount[]> => {
    const users = await db.selectFrom('users').selectAll().orderBy('role').orderBy('name').execute();
    const links = await db
      .selectFrom('user_departments as ud')
      .innerJoin('departments as d', 'd.id', 'ud.department_id')
      .select(['ud.user_id', 'd.id', 'd.name'])
      .where('d.deleted_at', 'is', null)
      .orderBy('d.sort_order')
      .execute();
    const now = nowIso();
    return users.map((u) => ({
      id: u.id,
      loginId: u.login_id,
      name: u.name,
      role: u.role,
      active: u.active === 1,
      mustChangePassword: u.must_change_password === 1,
      locked: Boolean(u.locked_until && u.locked_until > now),
      lastLoginAt: u.last_login_at,
      departments: links.filter((l) => l.user_id === u.id).map((l) => ({ id: l.id, name: l.name })),
    }));
  });

  app.post('/api/users', { preHandler: requireAdmin }, async (req) => {
    const body = CreateUserBody.parse(req.body);
    const policy = checkPasswordPolicy(body.password);
    if (policy) throw badRequest(policy);
    const exists = await db.selectFrom('users').select('id').where('login_id', '=', body.loginId).executeTakeFirst();
    if (exists) throw new HttpError(409, '이미 쓰고 있는 아이디입니다.');
    const departmentIds = body.role === 'clerk' ? body.departmentIds : [];
    await assertDepartmentsExist(db, departmentIds);
    const passwordHash = await hashPassword(body.password);

    const id = await db.transaction().execute(async (trx) => {
      const user = await trx
        .insertInto('users')
        .values({
          login_id: body.loginId,
          name: body.name,
          role: body.role,
          password_hash: passwordHash,
          must_change_password: 1,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (departmentIds.length > 0) {
        await trx
          .insertInto('user_departments')
          .values(departmentIds.map((departmentId) => ({ user_id: user.id, department_id: departmentId })))
          .execute();
      }
      return user.id;
    });
    // 권한 부여 기록 (보관 기간: 3년 이상)
    await audit(db, req, 'user.create', { type: 'user', id }, { loginId: body.loginId, role: body.role, departmentIds });
    return { id };
  });

  app.patch('/api/users/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = UpdateUserBody.parse(req.body);
    const me = currentUser(req);
    const user = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    if (!user) throw notFound('계정을 찾을 수 없습니다.');

    if (id === me.id && (body.active === false || (body.role && body.role !== 'admin'))) {
      throw badRequest('자기 계정을 사용 중지하거나 관리자 권한을 뺄 수는 없습니다.');
    }
    const losesAdmin =
      user.role === 'admin' && user.active === 1 && (body.active === false || (body.role && body.role !== 'admin'));
    if (losesAdmin && (await activeAdminCount(db)) <= 1) {
      throw badRequest('관리자 계정이 최소 1개는 있어야 합니다.');
    }

    const role = body.role ?? user.role;
    if (body.departmentIds) await assertDepartmentsExist(db, body.departmentIds);

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.role !== undefined ? { role: body.role } : {}),
          ...(body.active !== undefined ? { active: body.active ? 1 : 0 } : {}),
          updated_at: nowIso(),
        })
        .where('id', '=', id)
        .execute();
      // 관리자는 전체 부서를 보므로 담당 부서를 따로 두지 않는다
      if (body.departmentIds !== undefined || role === 'admin') {
        await trx.deleteFrom('user_departments').where('user_id', '=', id).execute();
        const ids = role === 'clerk' ? (body.departmentIds ?? []) : [];
        if (ids.length > 0) {
          await trx
            .insertInto('user_departments')
            .values(ids.map((departmentId) => ({ user_id: id, department_id: departmentId })))
            .execute();
        }
      }
    });
    if (body.active === false) await destroyUserSessions(db, id);
    await audit(db, req, 'user.update', { type: 'user', id }, body);
    return { ok: true };
  });

  // 비밀번호 초기화: 다음 로그인 때 새 비밀번호를 정하게 하고, 잠금도 푼다
  app.post('/api/users/:id/reset-password', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = ResetPasswordBody.parse(req.body);
    const policy = checkPasswordPolicy(body.password);
    if (policy) throw badRequest(policy);
    const result = await db
      .updateTable('users')
      .set({
        password_hash: await hashPassword(body.password),
        must_change_password: 1,
        failed_logins: 0,
        locked_until: null,
        updated_at: nowIso(),
      })
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw notFound('계정을 찾을 수 없습니다.');
    await destroyUserSessions(db, id);
    await audit(db, req, 'user.reset-password', { type: 'user', id });
    return { ok: true };
  });
}
