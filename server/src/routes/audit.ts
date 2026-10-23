import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actionsOf, AUDIT_CATEGORIES, type AuditCategory } from '../../../shared/auditActions.ts';
import type { AuditPage } from '../../../shared/types.ts';
import { requireAdmin } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';

// 설정 > 감사 로그 (관리자만). 누가 언제 무엇을 했는지 기간·작업·사용자로 찾아본다.

const PAGE_SIZE = 50;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식입니다.');

const AuditQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  category: z.enum(Object.keys(AUDIT_CATEGORIES) as [AuditCategory, ...AuditCategory[]]).optional(),
  user: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

/** 한국 시각 날짜의 0시를 저장 형식(UTC ISO)으로 */
function seoulStart(date: string, addDays = 0): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString();
}

export async function auditRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/api/audit', { preHandler: requireAdmin }, async (req): Promise<AuditPage> => {
    const q = AuditQuery.parse(req.query);
    const base = db
      .selectFrom('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .$if(q.from !== undefined, (qb) => qb.where('a.at', '>=', seoulStart(q.from!)))
      .$if(q.to !== undefined, (qb) => qb.where('a.at', '<', seoulStart(q.to!, 1)))
      .$if(q.category !== undefined, (qb) => qb.where('a.action', 'in', actionsOf(q.category!)))
      .$if(!!q.user, (qb) => qb.where((eb) => eb.or([eb('a.user_login', 'like', `%${q.user}%`), eb('u.name', 'like', `%${q.user}%`)])));

    const { n } = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await base
      .select(['a.id', 'a.at', 'a.user_login', 'u.name as user_name', 'a.action', 'a.target_type', 'a.target_id', 'a.detail', 'a.ip'])
      .orderBy('a.id', 'desc')
      .limit(PAGE_SIZE)
      .offset((q.page - 1) * PAGE_SIZE)
      .execute();

    return {
      entries: rows.map((r) => ({
        id: r.id,
        at: r.at,
        userLogin: r.user_login,
        userName: r.user_name,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : null,
        ip: r.ip,
      })),
      total: Number(n),
      page: q.page,
      pageSize: PAGE_SIZE,
    };
  });
}
