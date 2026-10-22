import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';

/**
 * 누가 언제 무엇을 했는지 감사 로그에 남긴다.
 * 개인정보(생년월일 등)는 detail에 넣지 않는다.
 */
export async function audit(
  db: Kysely<DB>,
  req: FastifyRequest,
  action: string,
  target?: { type: string; id: number | string },
  detail?: Record<string, unknown>,
  actor?: { id: number; loginId: string },
): Promise<void> {
  const who = actor ?? req.user;
  await db
    .insertInto('audit_log')
    .values({
      user_id: who?.id ?? null,
      user_login: who?.loginId ?? null,
      action,
      target_type: target?.type ?? null,
      target_id: target ? String(target.id) : null,
      detail: detail ? JSON.stringify(detail) : null,
      ip: req.ip,
    })
    .execute();
}
