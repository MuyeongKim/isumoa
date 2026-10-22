import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppMeta } from '../../../shared/types.ts';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../auth/password.ts';
import { createSession, destroySession, destroyUserSessions, SESSION_COOKIE } from '../auth/sessions.ts';
import { currentUser, requireUser } from '../auth/guard.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { cleanText } from '../lib/text.ts';

/** 로그인 실패가 이만큼 이어지면 잠시 잠근다 */
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 10;

const loginIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]{3,30}$/, '아이디는 영문·숫자·._- 조합 3~30자로 정해 주세요.');

const SetupBody = z.object({
  orgName: z.string().trim().min(1, '기관명을 입력해 주세요.').max(100),
  loginId: loginIdSchema,
  name: z.string().trim().min(1, '이름을 입력해 주세요.').max(50),
  password: z.string().min(1).max(200),
});

const LoginBody = z.object({
  loginId: z.string().trim().min(1, '아이디를 입력해 주세요.'),
  password: z.string().min(1, '비밀번호를 입력해 주세요.'),
});

const PasswordBody = z.object({
  currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요.'),
  newPassword: z.string().min(1).max(200),
});

export async function authRoutes(app: FastifyInstance, { db, config, version }: Deps) {
  // 존재하지 않는 아이디도 비밀번호 확인과 비슷한 시간이 걸리게 해서 아이디 존재 여부를 숨긴다
  const dummyHash = await hashPassword('timing-guard-password');

  async function startSession(req: FastifyRequest, reply: FastifyReply, userId: number) {
    const token = await createSession(db, userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      maxHours: config.sessionMaxHours,
    });
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      maxAge: config.sessionMaxHours * 3600,
    });
  }

  async function userCount(): Promise<number> {
    const row = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();
    return row.count;
  }

  app.get('/api/meta', async (): Promise<AppMeta> => {
    const org = await getSetting(db, 'org', { name: '' });
    return { orgName: org.name, needsSetup: (await userCount()) === 0, version };
  });

  // 처음 실행: 관리자 계정이 하나도 없을 때만 동작한다
  app.post('/api/setup', async (req, reply) => {
    const body = SetupBody.parse(req.body);
    const policy = checkPasswordPolicy(body.password);
    if (policy) throw badRequest(policy);
    const passwordHash = await hashPassword(body.password);

    const userId = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('users')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      if (existing.count > 0) throw new HttpError(409, '이미 초기 설정이 끝났습니다.');
      const user = await trx
        .insertInto('users')
        .values({ login_id: body.loginId, name: body.name, role: 'admin', password_hash: passwordHash })
        .returning('id')
        .executeTakeFirstOrThrow();
      return user.id;
    });
    await setSetting(db, 'org', { name: body.orgName });
    await audit(db, req, 'setup', { type: 'user', id: userId }, { orgName: body.orgName }, {
      id: userId,
      loginId: body.loginId,
    });
    await startSession(req, reply, userId);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginBody.parse(req.body);
    const user = await db.selectFrom('users').selectAll().where('login_id', '=', body.loginId).executeTakeFirst();
    const fail = () => reply.code(401).send({ error: { message: '아이디 또는 비밀번호가 올바르지 않습니다.' } });

    if (!user || user.active !== 1) {
      await verifyPassword(body.password, dummyHash);
      return fail();
    }
    if (user.locked_until && user.locked_until > nowIso()) {
      const minutes = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60_000);
      return reply.code(423).send({
        error: { message: `로그인 실패가 반복되어 계정이 잠겼습니다. ${minutes}분 후 다시 시도하거나 관리자에게 문의하세요.` },
      });
    }

    if (!(await verifyPassword(body.password, user.password_hash))) {
      const failed = user.failed_logins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      await db
        .updateTable('users')
        .set({
          failed_logins: lock ? 0 : failed,
          locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
        })
        .where('id', '=', user.id)
        .execute();
      await audit(db, req, lock ? 'login.locked' : 'login.failed', { type: 'user', id: user.id }, undefined, {
        id: user.id,
        loginId: user.login_id,
      });
      return fail();
    }

    await db
      .updateTable('users')
      .set({ failed_logins: 0, locked_until: null, last_login_at: nowIso() })
      .where('id', '=', user.id)
      .execute();
    await audit(db, req, 'login', { type: 'user', id: user.id }, undefined, { id: user.id, loginId: user.login_id });
    await startSession(req, reply, user.id);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) {
      await audit(db, req, 'logout');
      await destroySession(db, req.sessionToken);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => currentUser(req));

  app.post('/api/auth/password', { preHandler: requireUser }, async (req, reply) => {
    const me = currentUser(req);
    const body = PasswordBody.parse(req.body);
    const user = await db.selectFrom('users').selectAll().where('id', '=', me.id).executeTakeFirstOrThrow();
    if (!(await verifyPassword(body.currentPassword, user.password_hash))) {
      throw badRequest('현재 비밀번호가 올바르지 않습니다.');
    }
    if (body.newPassword === body.currentPassword) throw badRequest('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
    const policy = checkPasswordPolicy(body.newPassword);
    if (policy) throw badRequest(policy);
    if (cleanText(body.newPassword).toLowerCase().includes(user.login_id.toLowerCase())) {
      throw badRequest('비밀번호에 아이디를 넣을 수 없습니다.');
    }

    await db
      .updateTable('users')
      .set({ password_hash: await hashPassword(body.newPassword), must_change_password: 0, updated_at: nowIso() })
      .where('id', '=', me.id)
      .execute();
    await audit(db, req, 'password.change', { type: 'user', id: me.id });
    // 다른 곳에 남아 있는 로그인은 모두 끊고 지금 세션만 새로 만든다
    await destroyUserSessions(db, me.id);
    await startSession(req, reply, me.id);
    return { ok: true };
  });
}
