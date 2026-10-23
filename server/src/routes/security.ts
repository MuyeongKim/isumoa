import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { AccessLogPage, AccessReview, LogIntegrity, PurgeCandidate, RetentionView } from '../../../shared/types.ts';
import { requireAdmin } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest } from '../lib/errors.ts';
import { verifyChain } from '../lib/logChain.ts';
import { loadRetention, purgeCandidates, purgeYear, RETENTION_MIN, saveRetention, seoulYear } from '../ops/retention.ts';

// 설정 > 접속기록, 설정 > 백업·보관(보관기간·파기). 관리자만.

const PAGE_SIZE = 50;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD 형식입니다.');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '달은 YYYY-MM 형식입니다.');

const AccessQuery = z.object({
  from: ymd.optional(),
  to: ymd.optional(),
  user: z.string().trim().max(50).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

const ReviewBody = z.object({ month, note: z.string().trim().max(500).optional() });

const RetentionBody = z.object({
  documentYears: z.number().int().min(RETENTION_MIN.documentYears).max(30),
  accessLogYears: z.number().int().min(RETENTION_MIN.accessLogYears, '접속기록은 2년 이상 보관해야 합니다.').max(10),
  auditLogYears: z.number().int().min(RETENTION_MIN.auditLogYears, '권한 변경 이력이 든 감사 로그는 3년 이상 보관해야 합니다.').max(10),
  backupKeep: z.number().int().min(RETENTION_MIN.backupKeep).max(365),
});

const PurgeBody = z.object({ year: z.number().int(), confirm: z.string() });

/** 한국 시각 날짜의 0시 (UTC ISO) */
function seoulStart(date: string, addDays = 0): string {
  const d = new Date(`${date}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString();
}

function monthRange(m: string): [string, string] {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return [seoulStart(`${m}-01`), seoulStart(`${next}-01`)];
}

export async function securityRoutes(app: FastifyInstance, { db, config }: Deps) {
  app.get('/api/access-log', { preHandler: requireAdmin }, async (req): Promise<AccessLogPage> => {
    const q = AccessQuery.parse(req.query);
    const base = db
      .selectFrom('access_log as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .$if(q.from !== undefined, (qb) => qb.where('a.at', '>=', seoulStart(q.from!)))
      .$if(q.to !== undefined, (qb) => qb.where('a.at', '<', seoulStart(q.to!, 1)))
      .$if(!!q.user, (qb) => qb.where((eb) => eb.or([eb('a.user_login', 'like', `%${q.user}%`), eb('u.name', 'like', `%${q.user}%`)])))
      .$if(!!q.q, (qb) => qb.where('a.path', 'like', `%${q.q}%`));
    const { n } = await base.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await base
      .select(['a.id', 'a.at', 'a.user_login', 'u.name as user_name', 'a.method', 'a.path', 'a.status', 'a.ip'])
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
        method: r.method,
        path: r.path,
        status: r.status,
        ip: r.ip,
      })),
      total: Number(n),
      page: q.page,
      pageSize: PAGE_SIZE,
    };
  });

  // 월 1회 점검: 사용자별 요청·조회·변경·내려받기·야간 접속, 그달 내려받기 사유
  app.get('/api/access-log/review', { preHandler: requireAdmin }, async (req): Promise<AccessReview> => {
    const { month: m } = z.object({ month }).parse(req.query);
    const [from, to] = monthRange(m);
    const kstHour = sql<string>`strftime('%H', a.at, '+9 hours')`;
    const kstDow = sql<string>`strftime('%w', a.at, '+9 hours')`;
    const rows = await db
      .selectFrom('access_log as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select((eb) => [
        'a.user_login',
        eb.fn.max('u.name').as('user_name'),
        eb.fn.countAll<number>().as('requests'),
        sql<number>`sum(case when a.method = 'GET' then 1 else 0 end)`.as('views'),
        sql<number>`sum(case when a.method != 'GET' then 1 else 0 end)`.as('changes'),
        sql<number>`sum(case when a.path like '/api/exports/%' or a.path like '/api/files/%/original%' then 1 else 0 end)`.as('downloads'),
        sql<number>`sum(case when ${kstHour} < '07' or ${kstHour} >= '21' or ${kstDow} in ('0', '6') then 1 else 0 end)`.as('after_hours'),
      ])
      .where('a.at', '>=', from)
      .where('a.at', '<', to)
      .groupBy('a.user_login')
      .orderBy('requests', 'desc')
      .execute();
    const failed = await db
      .selectFrom('audit_log')
      .select((eb) => ['user_login', eb.fn.countAll<number>().as('n')])
      .where('action', 'in', ['login.failed', 'login.locked'])
      .where('at', '>=', from)
      .where('at', '<', to)
      .groupBy('user_login')
      .execute();
    const downloads = await db
      .selectFrom('audit_log as a')
      .leftJoin('users as u', 'u.id', 'a.user_id')
      .select(['a.at', 'a.user_login', 'u.name as user_name', 'a.action', 'a.detail'])
      .where('a.action', 'in', ['export.excel', 'export.zip', 'export.pdf', 'file.download'])
      .where('a.at', '>=', from)
      .where('a.at', '<', to)
      .orderBy('a.id')
      .execute();
    const reviewed = await db
      .selectFrom('audit_log')
      .select(['at', 'user_login', 'detail'])
      .where('action', '=', 'accesslog.review')
      .where(sql<string>`json_extract(detail, '$.month')`, '=', m)
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();

    const users = rows.map((r) => ({
      userLogin: r.user_login ?? '(알 수 없음)',
      userName: r.user_name ?? null,
      requests: Number(r.requests),
      views: Number(r.views),
      changes: Number(r.changes),
      downloads: Number(r.downloads),
      afterHours: Number(r.after_hours),
      failedLogins: Number(failed.find((f) => f.user_login === r.user_login)?.n ?? 0),
    }));
    // 접속은 못 했지만 로그인 실패만 있는 계정도 보여 준다
    for (const f of failed) {
      if (f.user_login && !users.some((u) => u.userLogin === f.user_login)) {
        users.push({ userLogin: f.user_login, userName: null, requests: 0, views: 0, changes: 0, downloads: 0, afterHours: 0, failedLogins: Number(f.n) });
      }
    }
    return {
      month: m,
      users,
      downloads: downloads.map((d) => {
        const detail = d.detail ? (JSON.parse(d.detail) as Record<string, unknown>) : {};
        return {
          at: d.at,
          userLogin: d.user_login,
          userName: d.user_name,
          action: d.action,
          reason: typeof detail.reason === 'string' ? detail.reason : null,
          scope: typeof detail.scope === 'string' ? detail.scope : null,
        };
      }),
      reviewed: reviewed
        ? { at: reviewed.at, by: reviewed.user_login, note: ((JSON.parse(reviewed.detail ?? '{}') as { note?: string }).note ?? null) || null }
        : null,
    };
  });

  app.post('/api/access-log/review', { preHandler: requireAdmin }, async (req) => {
    const body = ReviewBody.parse(req.body);
    await audit(db, req, 'accesslog.review', undefined, { month: body.month, note: body.note ?? '' });
    return { ok: true };
  });

  // 감사 로그·접속기록 위·변조 확인
  app.post('/api/logs/verify', { preHandler: requireAdmin }, async (req): Promise<LogIntegrity> => {
    const result = { checkedAt: new Date().toISOString(), audit: await verifyChain(db, 'audit_log'), access: await verifyChain(db, 'access_log') };
    await audit(db, req, 'logs.verify', undefined, {
      audit: result.audit.ok ? `정상 ${result.audit.checked}건` : `이상 #${result.audit.brokenAt}`,
      access: result.access.ok ? `정상 ${result.access.checked}건` : `이상 #${result.access.brokenAt}`,
    });
    return result;
  });

  app.get('/api/retention', { preHandler: requireAdmin }, async (): Promise<RetentionView> => {
    const settings = await loadRetention(db);
    return { settings, minimum: RETENTION_MIN, candidates: await purgeCandidates(db, settings), thisYear: seoulYear() };
  });

  app.put('/api/retention', { preHandler: requireAdmin }, async (req): Promise<RetentionView> => {
    const settings = RetentionBody.parse(req.body);
    await saveRetention(db, settings);
    await audit(db, req, 'settings.retention', undefined, { ...settings });
    return { settings, minimum: RETENTION_MIN, candidates: await purgeCandidates(db, settings), thisYear: seoulYear() };
  });

  // 파기: 보관기간이 지난 연도를 확인 문구(연도)를 넣어야 지운다. 파기 대장으로 감사 로그에 남긴다
  app.post('/api/retention/purge', { preHandler: requireAdmin }, async (req): Promise<PurgeCandidate & { fileErrors: number }> => {
    const { year, confirm } = PurgeBody.parse(req.body);
    if (confirm.trim() !== String(year)) throw badRequest(`확인을 위해 파기할 연도(${year})를 그대로 입력해 주세요.`);
    const candidates = await purgeCandidates(db, await loadRetention(db));
    if (!candidates.some((c) => c.year === year)) throw badRequest(`${year}년 자료는 아직 보관기간이 남았거나 남은 자료가 없습니다.`);
    const result = await purgeYear(db, config.dataDir, year);
    await audit(db, req, 'retention.purge', undefined, { ...result });
    return result;
  });
}
