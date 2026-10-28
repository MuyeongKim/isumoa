import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SessionUser } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';

// 로그인 세션: 쿠키에는 무작위 토큰을, DB에는 그 토큰의 SHA-256 값만 저장한다.

export const SESSION_COOKIE = 'ecp_sid';

/** 마지막 접속 시각은 1분에 한 번만 갱신해 DB 쓰기를 줄인다 */
const TOUCH_INTERVAL_MS = 60_000;

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Kysely<DB>,
  userId: number,
  meta: { ip: string; userAgent: string | undefined; maxHours: number },
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  await db
    .insertInto('sessions')
    .values({
      id: sessionId(token),
      user_id: userId,
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      expires_at: new Date(now.getTime() + meta.maxHours * 3_600_000).toISOString(),
      ip: meta.ip,
      user_agent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .execute();
  return token;
}

/** 토큰이 유효하면 로그인한 사용자 정보를, 만료·무효면 null을 돌려준다 */
export async function resolveSession(
  db: Kysely<DB>,
  token: string,
  idleMinutes: number,
): Promise<SessionUser | null> {
  const id = sessionId(token);
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.last_seen_at',
      'sessions.expires_at',
      'users.id',
      'users.login_id',
      'users.name',
      'users.role',
      'users.must_change_password',
      'users.active',
    ])
    .where('sessions.id', '=', id)
    .executeTakeFirst();
  if (!row) return null;

  const now = Date.now();
  const idleExpired = now - Date.parse(row.last_seen_at) > idleMinutes * 60_000;
  if (!row.active || now > Date.parse(row.expires_at) || idleExpired) {
    await db.deleteFrom('sessions').where('id', '=', id).execute();
    return null;
  }
  if (now - Date.parse(row.last_seen_at) > TOUCH_INTERVAL_MS) {
    await db.updateTable('sessions').set({ last_seen_at: nowIso() }).where('id', '=', id).execute();
  }

  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    departments: await userDepartments(db, row.id),
  };
}

async function userDepartments(db: Kysely<DB>, userId: number): Promise<SessionUser['departments']> {
  const departments = await db
    .selectFrom('user_departments')
    .innerJoin('departments', 'departments.id', 'user_departments.department_id')
    .select(['departments.id', 'departments.name'])
    .where('user_departments.user_id', '=', userId)
    .where('departments.deleted_at', 'is', null)
    .orderBy('departments.sort_order')
    .orderBy('departments.name')
    .execute();
  return departments.map((d) => ({ id: d.id, name: d.name }));
}

/**
 * 단일 사용자 모드에서 로그인 없이 쓰는 사용자: 사용 중인(active=1) 관리자 가운데 가장 먼저 만든 계정.
 * 비밀번호 변경 요구는 이 모드에서 의미가 없으므로 항상 false로 돌려준다. 관리자가 없으면 null.
 */
export async function firstAdminUser(db: Kysely<DB>): Promise<SessionUser | null> {
  const row = await db
    .selectFrom('users')
    .select(['id', 'login_id', 'name', 'role'])
    .where('role', '=', 'admin')
    .where('active', '=', 1)
    .orderBy('id')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    loginId: row.login_id,
    name: row.name,
    role: row.role,
    mustChangePassword: false,
    departments: await userDepartments(db, row.id),
  };
}

export async function destroySession(db: Kysely<DB>, token: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', sessionId(token)).execute();
}

export async function destroyUserSessions(db: Kysely<DB>, userId: number): Promise<void> {
  await db.deleteFrom('sessions').where('user_id', '=', userId).execute();
}

export async function purgeExpiredSessions(db: Kysely<DB>, idleMinutes: number): Promise<void> {
  const idleLimit = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  await db
    .deleteFrom('sessions')
    .where((eb) => eb.or([eb('expires_at', '<', nowIso()), eb('last_seen_at', '<', idleLimit)]))
    .execute();
}
