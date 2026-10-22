import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { SessionUser } from '../../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { HttpError } from '../lib/errors.ts';
import { resolveSession, SESSION_COOKIE } from './sessions.ts';

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
 */
export function registerAuth(app: FastifyInstance, deps: { db: Kysely<DB>; config: AppConfig }) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'fetch') {
      return reply.code(403).send({ error: { message: '허용되지 않은 요청입니다.' } });
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const user = await resolveSession(deps.db, token, deps.config.sessionIdleMinutes);
    if (!user) {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return;
    }
    req.user = user;
    req.sessionToken = token;

    const path = req.url.split('?')[0];
    if (user.mustChangePassword && !ALLOWED_BEFORE_PASSWORD_CHANGE.has(path)) {
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
