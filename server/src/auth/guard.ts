import { updateLocked } from '../updates/service.ts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { SessionUser } from '../../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { HttpError } from '../lib/errors.ts';
import { firstAdminUser, resolveSession, SESSION_COOKIE } from './sessions.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | null;
  }
}

/** 비밀번호를 바꿔야 하는 사용자도 쓸 수 있는 API */
const ALLOWED_BEFORE_PASSWORD_CHANGE = new Set(['/api/auth/me', '/api/auth/password', '/api/auth/logout', '/api/meta']);

/**
 * 모든 /api 요청에서
 * 1) 데이터를 바꾸는 요청에 우리 화면이 붙이는 헤더가 있는지 확인하고(다른 사이트가 보낸 요청 차단),
 * 2) 세션 쿠키로 로그인한 사용자를 찾아 request.user에 넣는다.
 *    단일 사용자 모드(config.singleUser)에서는 유효한 세션이 없는 요청을 첫 관리자로 처리하고,
 *    비밀번호 변경 요구도 건너뛴다 (로그인 화면·비밀번호 변경 화면이 없는 모드이므로).
 */
export function registerAuth(app: FastifyInstance, deps: { db: Kysely<DB>; config: AppConfig }) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.url.startsWith('/api/system/update') && !req.url.startsWith('/api/system/shutdown') && updateLocked(deps.config)) return reply.code(503).send({ error: { message: '업데이트 중입니다. 재실행이 끝난 뒤 다시 시도해 주세요.' } });

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'fetch') {
      return reply.code(403).send({ error: { message: '허용되지 않은 요청입니다.' } });
    }

    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await resolveSession(deps.db, token, deps.config.sessionIdleMinutes) : null;
    if (token && !user) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    if (!user) {
      if (deps.config.singleUser) req.user = await firstAdminUser(deps.db);
      return;
    }
    req.user = user;
    req.sessionToken = token ?? null;

    const path = req.url.split('?')[0];
    if (!deps.config.singleUser && user.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(path)) {
      return reply
        .code(403)
        .send({ error: { message: '비밀번호를 먼저 변경해 주세요.', code: 'PASSWORD_CHANGE_REQUIRED' } });
    }
  });
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: { message: '로그인이 필요합니다.', code: 'UNAUTHENTICATED' } });
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) return reply.code(401).send({ error: { message: '로그인이 필요합니다.', code: 'UNAUTHENTICATED' } });
  if (req.user.role !== 'admin') return reply.code(403).send({ error: { message: '관리자만 사용할 수 있습니다.' } });
}

/** 로그인한 사용자 (requireUser 다음에만 호출) */
export function currentUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHENTICATED');
  return req.user;
}

/** 볼 수 있는 부서 id 목록. 관리자는 전체라서 null */
export function departmentScope(user: SessionUser): number[] | null {
  return user.role === 'admin' ? null : user.departments.map((d) => d.id);
}

export function assertDepartmentInScope(user: SessionUser, departmentId: number | null) {
  if (user.role === 'admin') return;
  if (departmentId === null || !user.departments.some((d) => d.id === departmentId)) {
    throw new HttpError(403, '담당 부서의 직원만 다룰 수 있습니다.');
  }
}
