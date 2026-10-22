import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import { CERTIFICATE_STATUSES, type CertificateDetail, type CertificateListItem } from '../../../shared/types.ts';
import { currentUser, requireUser } from '../auth/guard.ts';
import { hasBlockingFlag } from '../certs/flags.ts';
import {
  canViewCertificate,
  evaluateFlags,
  getCertificateDetail,
  getCertificateRow,
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

const text = (max: number) => z.string().max(max).nullable().transform((v) => cleanOrNull(v));

const CertificateBody = z.object({
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
  courseTitle: text(300),
  provider: text(100),
  certNo: text(100),
  year: z.number().int().min(2000).max(2100).nullable(),
});
type CertificateBody = z.infer<typeof CertificateBody>;

const ExcludeBody = z.object({ reason: z.string().trim().min(1, '제외 사유를 골라 주세요.').max(200) });

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
    if (body.employeeId !== null && body.employeeId !== row.employee_id) {
      const e = await trx.selectFrom('employees').select('department_id').where('id', '=', body.employeeId).executeTakeFirst();
      if (!e) throw badRequest('없는 직원입니다.');
      if (scope && (e.department_id === null || !scope.includes(e.department_id))) {
        throw new HttpError(403, '담당 부서 직원만 고를 수 있습니다.');
      }
    }
    const trainingIds = [...new Set(body.credits.map((c) => c.trainingId))];
    if (trainingIds.length > 0) {
      const found = await trx.selectFrom('trainings').select('id').where('id', 'in', trainingIds).execute();
      if (found.length !== trainingIds.length) throw badRequest('없는 교육이 포함되어 있습니다.');
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
          confirmed_by: user.id,
          confirmed_at: nowIso(),
          updated_at: nowIso(),
        })
        .where('id', '=', id)
        .execute();

      // 다음에 같은 과정명이 오면 같은 교육으로 정하도록 기억한다 (가장 최근 확정이 기준)
      if (saved.course_title) {
        const key = courseTitleKey(saved.course_title);
        const ids = [...new Set(body.credits.map((c) => c.trainingId))];
        if (key && ids.length > 0) {
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
      }
    });
    await audit(db, req, 'certificate.confirm', { type: 'certificate', id });
    return getCertificateDetail(db, (await getCertificateRow(db, id))!, user);
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
