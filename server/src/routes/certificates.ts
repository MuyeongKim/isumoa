import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  CERTIFICATE_STATUSES,
  type BulkConfirmResult,
  type CertificateDetail,
  type CertificateFlag,
  type CertificateListItem,
} from '../../../shared/types.ts';
import { currentUser, requireUser } from '../auth/guard.ts';
import { hasBlockingFlag } from '../certs/flags.ts';
import { bulkExclude, previewBulkExclude } from '../certs/bulkExclude.ts';
import { previewReviewReset, resetReviewDrafts } from '../certs/reset.ts';
import {
  canViewCertificate,
  evaluateFlags,
  getCertificateDetail,
  getCertificateRow,
  isReading,
  listCertificates,
  scopeOf,
  type CertificateRow,
} from '../certs/review.ts';
import { courseTitleKey } from '../certs/trainingClassifier.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { parseDateLoose } from '../lib/dates.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { cleanOrNull } from '../lib/text.ts';

// 검수함: 처리된 이수증을 확인·수정하고 확정하거나 제외한다.

const IdParams = z.object({ id: z.coerce.number().int().positive() });

const ListQuery = z.object({
  status: z.enum(CERTIFICATE_STATUSES).optional(),
  batchId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  trainingId: z.coerce.number().int().positive().optional(),
  year: z.coerce.number().int().optional(),
});

const text = (max: number, label: string) => z.string().max(max, `${label}은 ${max}자 이내로 입력해 주세요.`).nullable().transform((v) => cleanOrNull(v));

export const CertificateBody = z.object({
  employeeId: z.number().int().positive().nullable(),
  credits: z
    .array(z.object({ trainingId: z.number().int().positive(), creditedHours: z.number().min(0).max(1000).nullable() }))
    .max(30),
  completedOn: z
    .string()
    .nullable()
    .transform((value, ctx) => {
      if (value === null || value.trim() === '') return null;
      const parsed = parseDateLoose(value).value;
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: '이수일 형식을 확인해 주세요 (예: 2026-03-31).' });
        return z.NEVER;
      }
      return parsed;
    }),
  hours: z.number().min(0, '교육시간은 0 이상이어야 합니다.').max(1000).nullable(),
  courseTitle: text(300, '과정명'),
  provider: text(100, '교육기관'),
  certNo: text(100, '증서번호'),
  year: z.number().int().min(2000).max(2100).nullable(),
});
type CertificateBody = z.infer<typeof CertificateBody>;

const ExcludeBody = z.object({ reason: z.string().trim().min(1, '제외 사유를 골라 주세요.').max(200) });

const BulkConfirmBody = z.object({ ids: z.array(z.number().int().positive()).min(1).max(500) });
const BulkExcludeBody = BulkConfirmBody.extend({ token: z.string().regex(/^[a-f0-9]{64}$/), reason: ExcludeBody.shape.reason });
const ResetScope = z.object({ batchId: z.coerce.number().int().positive().optional() });

/** 확정으로 바꾸고, 다음에 같은 과정명이 오면 같은 교육으로 정하도록 기억한다 (가장 최근 확정이 기준) */
async function markConfirmed(trx: Kysely<DB>, saved: CertificateRow, flags: CertificateFlag[], trainingIds: number[], userId: number) {
  const dept = await trx
    .selectFrom('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select('d.name')
    .where('e.id', '=', saved.employee_id!)
    .executeTakeFirst();
  await trx
    .updateTable('certificates')
    .set({
      status: 'confirmed',
      flags: JSON.stringify(flags),
      dept_snapshot: dept?.name ?? null,
      confirmed_by: userId,
      confirmed_at: nowIso(),
      updated_at: nowIso(),
    })
    .where('id', '=', saved.id)
    .execute();

  if (!saved.course_title) return;
  const key = courseTitleKey(saved.course_title);
  const ids = [...new Set(trainingIds)];
  if (!key || ids.length === 0) return;
  await trx.deleteFrom('course_mappings').where('title_key', '=', key).where('training_id', 'not in', ids).execute();
  for (const trainingId of ids) {
    await trx
      .insertInto('course_mappings')
      .values({ title_key: key, training_id: trainingId })
      .onConflict((oc) =>
        oc.columns(['title_key', 'training_id']).doUpdateSet((eb) => ({
          confirmations: eb('course_mappings.confirmations', '+', 1),
          updated_at: nowIso(),
        })),
      )
      .execute();
  }
}

export async function certificateRoutes(app: FastifyInstance, { db }: Deps) {
  async function loadVisible(id: number, user: Parameters<typeof canViewCertificate>[2]): Promise<CertificateRow> {
    const row = await getCertificateRow(db, id);
    if (!row) throw notFound('이수증을 찾을 수 없습니다.');
    if (!(await canViewCertificate(db, row, user))) throw new HttpError(403, '볼 수 없는 이수증입니다.');
    return row;
  }

  /** 검수 대기 이수증에 입력값을 저장한다 (확정 전 단계) */
  async function saveDraft(trx: Kysely<DB>, row: CertificateRow, body: CertificateBody, scope: number[] | null) {
    if (row.status !== 'draft') throw new HttpError(409, '확정하거나 제외한 이수증은 고칠 수 없습니다. 먼저 "검수 대기로 되돌리기"를 해 주세요.');
    if (body.employeeId !== null) {
      const e = await trx.selectFrom('employees').select('department_id').where('id', '=', body.employeeId).where('deleted_at', 'is', null).executeTakeFirst();
      if (!e) throw badRequest('없는 직원입니다.');
      if (scope && (e.department_id === null || !scope.includes(e.department_id))) {
        throw new HttpError(403, '담당 부서 직원만 고를 수 있습니다.');
      }
    }
    const trainingIds = [...new Set(body.credits.map((c) => c.trainingId))];
    if (trainingIds.length > 0) {
      const found = await trx.selectFrom('trainings').select('id').where('id', 'in', trainingIds).where('deleted_at', 'is', null).execute();
      if (found.length !== trainingIds.length) throw badRequest('없거나 삭제된 교육이 포함되어 있습니다. 교육을 복원하거나 다시 골라 주세요.');
    }
    await trx
      .updateTable('certificates')
      .set({
        employee_id: body.employeeId,
        completed_on: body.completedOn,
        hours: body.hours,
        course_title: body.courseTitle,
        provider: body.provider,
        cert_no: body.certNo,
        year: body.year ?? (body.completedOn ? Number(body.completedOn.slice(0, 4)) : row.batch_year),
        source: 'manual',
        updated_at: nowIso(),
      })
      .where('id', '=', row.id)
      .execute();
    await trx.deleteFrom('certificate_trainings').where('certificate_id', '=', row.id).execute();
    if (body.credits.length > 0) {
      await trx
        .insertInto('certificate_trainings')
        .values(
          trainingIds.map((trainingId) => ({
            certificate_id: row.id,
            training_id: trainingId,
            credited_hours: body.credits.find((c) => c.trainingId === trainingId)!.creditedHours,
          })),
        )
        .execute();
    }
  }

  app.get('/api/certificates', { preHandler: requireUser }, async (req): Promise<CertificateListItem[]> => {
    return listCertificates(db, ListQuery.parse(req.query), currentUser(req));
  });

  app.get('/api/certificates/reset-preview', { preHandler: requireUser }, async req => {
    const { batchId } = ResetScope.parse(req.query);
    return previewReviewReset(db, currentUser(req), batchId);
  });

  app.post('/api/certificates/reset-drafts', { preHandler: requireUser }, async req => {
    const { batchId, token } = ResetScope.extend({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(req.body);
    const result = await resetReviewDrafts(db, currentUser(req), token, batchId);
    await audit(db, req, 'certificate.reset-drafts', undefined, { batchId: batchId ?? null, ...result });
    return result;
  });

  app.post('/api/certificates/bulk-exclude-preview', { preHandler: requireUser }, async req => {
    return previewBulkExclude(db, currentUser(req), BulkConfirmBody.parse(req.body).ids);
  });

  app.post('/api/certificates/bulk-exclude', { preHandler: requireUser }, async req => {
    const { ids, token, reason } = BulkExcludeBody.parse(req.body);
    const { result, previous } = await bulkExclude(db, currentUser(req), ids, token, reason);
    for (const item of previous) await audit(db, req, 'certificate.exclude', { type: 'certificate', id: item.id }, { reason, from: item.status, bulk: true });
    await audit(db, req, 'certificate.bulk-exclude', undefined, { reason, ids: result.ids, excluded: result.excluded });
    return result;
  });

  app.get('/api/certificates/:id', { preHandler: requireUser }, async (req): Promise<CertificateDetail> => {
    const { id } = IdParams.parse(req.params);
    const user = currentUser(req);
    return getCertificateDetail(db, await loadVisible(id, user), user);
  });

  // 저장만 (다음에 이어서 검수)
  app.put('/api/certificates/:id', { preHandler: requireUser }, async (req): Promise<CertificateDetail> => {
    const { id } = IdParams.parse(req.params);
    const user = currentUser(req);
    const body = CertificateBody.parse(req.body);
    const row = await loadVisible(id, user);
    await db.transaction().execute((trx) => saveDraft(trx, row, body, scopeOf(user)));
    const saved = (await getCertificateRow(db, id))!;
    const flags = await evaluateFlags(db, saved, scopeOf(user));
    await db.updateTable('certificates').set({ flags: JSON.stringify(flags) }).where('id', '=', id).execute();
    return getCertificateDetail(db, { ...saved, flags: JSON.stringify(flags) }, user);
  });

  // 저장하고 확정. 오류 표시가 남아 있으면 확정하지 않는다
  app.post('/api/certificates/:id/confirm', { preHandler: requireUser }, async (req): Promise<CertificateDetail> => {
    const { id } = IdParams.parse(req.params);
    const user = currentUser(req);
    const scope = scopeOf(user);
    const body = CertificateBody.parse(req.body);
    const row = await loadVisible(id, user);

    await db.transaction().execute(async (trx) => {
      await saveDraft(trx, row, body, scope);
      const saved = (await getCertificateRow(trx, id))!;
      const flags = await evaluateFlags(trx, saved, scope);
      if (hasBlockingFlag(flags)) {
        throw new HttpError(422, flags.find((f) => f.level === 'error')!.message, 'BLOCKING_FLAGS');
      }
      await markConfirmed(trx, saved, flags, body.credits.map((c) => c.trainingId), user.id);
    });
    await audit(db, req, 'certificate.confirm', { type: 'certificate', id });
    return getCertificateDetail(db, (await getCertificateRow(db, id))!, user);
  });

  // "정상 n건 일괄 확정": 확인할 점(오류·경고)이 하나도 없는 검수 대기 이수증만 확정한다.
  // 화면이 보낸 목록이라도 서버에서 지금 값으로 다시 확인한다.
  app.post('/api/certificates/bulk-confirm', { preHandler: requireUser }, async (req): Promise<BulkConfirmResult> => {
    const { ids } = BulkConfirmBody.parse(req.body);
    const user = currentUser(req);
    const scope = scopeOf(user);
    const result: BulkConfirmResult = { confirmed: 0, skipped: [] };
    for (const id of [...new Set(ids)]) {
      const row = await getCertificateRow(db, id);
      if (!row || !(await canViewCertificate(db, row, user))) {
        result.skipped.push({ id, reason: '볼 수 없는 이수증입니다.' });
        continue;
      }
      if (row.status !== 'draft') {
        result.skipped.push({ id, reason: '검수 대기 상태가 아닙니다.' });
        continue;
      }
      if (isReading(row.page_state)) {
        result.skipped.push({ id, reason: '원본 쪽을 다시 읽는 중입니다.' });
        continue;
      }
      const confirmed = await db.transaction().execute(async (trx) => {
        const flags = await evaluateFlags(trx, row, scope);
        const problem = flags.find((f) => f.level !== 'info');
        if (problem) return problem.message;
        const credits = await trx.selectFrom('certificate_trainings').select('training_id').where('certificate_id', '=', id).execute();
        await markConfirmed(trx, row, flags, credits.map((c) => c.training_id), user.id);
        return null;
      });
      if (confirmed === null) result.confirmed++;
      else result.skipped.push({ id, reason: confirmed });
    }
    await audit(db, req, 'certificate.bulk-confirm', undefined, { confirmed: result.confirmed, skipped: result.skipped.length });
    return result;
  });

  app.post('/api/certificates/:id/exclude', { preHandler: requireUser }, async (req): Promise<CertificateDetail> => {
    const { id } = IdParams.parse(req.params);
    const user = currentUser(req);
    const { reason } = ExcludeBody.parse(req.body);
    const row = await loadVisible(id, user);
    if (row.status !== 'draft') throw new HttpError(409, '검수 대기 중인 이수증만 제외할 수 있습니다.');
    await db
      .updateTable('certificates')
      .set({ status: 'excluded', exclude_reason: reason, updated_at: nowIso() })
      .where('id', '=', id)
      .execute();
    await audit(db, req, 'certificate.exclude', { type: 'certificate', id }, { reason });
    return getCertificateDetail(db, (await getCertificateRow(db, id))!, user);
  });

  app.post('/api/certificates/:id/reopen', { preHandler: requireUser }, async (req): Promise<CertificateDetail> => {
    const { id } = IdParams.parse(req.params);
    const user = currentUser(req);
    const row = await loadVisible(id, user);
    if (row.status === 'draft') return getCertificateDetail(db, row, user);
    await db
      .updateTable('certificates')
      .set({ status: 'draft', exclude_reason: null, confirmed_by: null, confirmed_at: null, dept_snapshot: null, updated_at: nowIso() })
      .where('id', '=', id)
      .execute();
    await audit(db, req, 'certificate.reopen', { type: 'certificate', id }, { from: row.status });
    return getCertificateDetail(db, (await getCertificateRow(db, id))!, user);
  });
}
