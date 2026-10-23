import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Kysely, Selectable } from 'kysely';
import { z } from 'zod';
import {
  FORM_MARK_STYLES,
  FORM_PERSON_FIELDS,
  FORM_TRAINING_FORMATS,
  type FormAnalysis,
  type FormColumn,
  type FormMarkStyle,
  type FormPreview,
  type FormTemplate,
  type SessionUser,
} from '../../../shared/types.ts';
import { currentUser, departmentScope, requireUser } from '../auth/guard.ts';
import { loadTrainings } from '../certs/review.ts';
import type { DB, FormTemplatesTable } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { analyzeForm, assertXlsx, type AnalyzeOptions } from '../forms/analyze.ts';
import { previewText } from '../forms/fill.ts';
import { loadFormPeople } from '../forms/people.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { cleanText } from '../lib/text.ts';

// 제출 양식: 올린 엑셀 양식을 읽어 자리를 찾고(analyze), 열 설정과 함께 저장한다.
// 관리자는 모든 양식을, 서무는 공용 양식과 담당 부서 양식을 쓰고 담당 부서 양식만 만들고 고친다.

// 양식을 올리고 저장하기까지 여러 단계라서, 올린 파일을 30분 동안 메모리에 둔다
const UPLOAD_TTL_MS = 30 * 60_000;
const uploads = new Map<string, { userId: number; fileName: string; file: Buffer; createdAt: number }>();
function sweepUploads() {
  const now = Date.now();
  for (const [id, item] of uploads) if (now - item.createdAt > UPLOAD_TTL_MS) uploads.delete(id);
}

const FillSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('person'), field: z.enum(FORM_PERSON_FIELDS) }),
  z.object({ kind: z.literal('training'), trainingId: z.number().int().positive(), format: z.enum(FORM_TRAINING_FORMATS) }),
  z.object({ kind: z.literal('missing') }),
]);
const ColumnsSchema = z
  .array(z.object({ col: z.number().int().min(1).max(16384), letter: z.string().max(3), label: z.string().max(300), fill: FillSchema }))
  .min(1)
  .max(200);
const LayoutSchema = z
  .object({
    sheetName: z.string().min(1).max(100),
    headerFirst: z.number().int().min(1),
    headerLast: z.number().int().min(1),
    dataFirst: z.number().int().min(2),
    footerRow: z.number().int().min(2),
  })
  .refine((l) => l.headerFirst <= l.headerLast && l.headerLast < l.dataFirst && l.dataFirst <= l.footerRow, {
    message: '줄 번호가 맞지 않습니다. 머리글 줄 < 첫 사람 줄 ≤ 합계·서명란 줄 순서여야 합니다.',
  });
const SaveBody = z.object({
  name: z.string().trim().min(1, '양식 이름을 적어 주세요.').max(100),
  departmentId: z.number().int().positive().nullable(),
  layout: LayoutSchema,
  columns: ColumnsSchema,
  markStyle: z.enum(FORM_MARK_STYLES),
});
const ReanalyzeBody = z.object({
  uploadId: z.string().uuid().optional(),
  formId: z.number().int().positive().optional(),
  sheetName: z.string().max(100).optional(),
  headerFirst: z.number().int().min(1).max(500).optional(),
  headerLast: z.number().int().min(1).max(500).optional(),
  dataFirst: z.number().int().min(2).max(5000).optional(),
  footerRow: z.number().int().min(2).max(5000).optional(),
});
const PreviewBody = z.object({
  year: z.number().int().min(2000).max(2100),
  departmentId: z.number().int().positive().nullable().optional(),
  columns: ColumnsSchema,
  markStyle: z.enum(FORM_MARK_STYLES),
});
const IdParams = z.object({ id: z.coerce.number().int().positive() });

/** 양식을 쓸 수 있는지: 관리자, 공용 양식, 담당 부서 양식 */
export function canUseForm(user: SessionUser, departmentId: number | null): boolean {
  return user.role === 'admin' || departmentId === null || user.departments.some((d) => d.id === departmentId);
}

/** 양식을 만들거나 고칠 수 있는지: 관리자, 또는 서무의 담당 부서 양식 (공용 양식은 관리자만) */
export function canEditForm(user: SessionUser, departmentId: number | null): boolean {
  return user.role === 'admin' || (departmentId !== null && user.departments.some((d) => d.id === departmentId));
}

export async function getForm(db: Kysely<DB>, id: number) {
  return db
    .selectFrom('form_templates as f')
    .leftJoin('departments as d', 'd.id', 'f.department_id')
    .leftJoin('users as u', 'u.id', 'f.created_by')
    .selectAll('f')
    .select(['d.name as department_name', 'u.name as created_by_name'])
    .where('f.id', '=', id)
    .executeTakeFirst();
}

type FormRow = Selectable<FormTemplatesTable> & { department_name: string | null; created_by_name: string | null };

function toForm(row: FormRow, user: SessionUser): FormTemplate {
  return {
    id: row.id,
    name: row.name,
    departmentId: row.department_id,
    departmentName: row.department_name,
    fileName: row.file_name,
    layout: { sheetName: row.sheet_name, headerFirst: row.header_first, headerLast: row.header_last, dataFirst: row.data_first, footerRow: row.footer_row },
    columns: JSON.parse(row.columns) as FormColumn[],
    markStyle: row.mark_style as FormMarkStyle,
    createdBy: row.created_by_name,
    updatedAt: row.updated_at,
    canEdit: canEditForm(user, row.department_id),
  };
}

export async function formRoutes(app: FastifyInstance, { db }: Deps) {
  async function assertDepartmentExists(departmentId: number | null) {
    if (departmentId === null) return;
    const found = await db.selectFrom('departments').select('id').where('id', '=', departmentId).executeTakeFirst();
    if (!found) throw notFound('부서를 찾을 수 없습니다.');
  }

  async function analysisFor(uploadId: string, fileName: string, file: Buffer | Uint8Array, options: AnalyzeOptions): Promise<FormAnalysis> {
    const analyzed = await analyzeForm(file, await loadTrainings(db), options);
    return { uploadId, fileName, ...analyzed };
  }

  // 양식 파일을 올리면 자리를 찾아 돌려준다 (저장은 아직 안 함)
  app.post('/api/forms/analyze', { preHandler: requireUser }, async (req): Promise<FormAnalysis> => {
    const user = currentUser(req);
    const part = await req.file();
    if (!part) throw badRequest('양식 파일을 골라 주세요.');
    const fileName = part.filename.normalize('NFC');
    const file = await part.toBuffer();
    assertXlsx(file, fileName);
    sweepUploads();
    const uploadId = randomUUID();
    const analysis = await analysisFor(uploadId, fileName, file, {});
    uploads.set(uploadId, { userId: user.id, fileName, file, createdAt: Date.now() });
    return analysis;
  });

  // 시트·머리글 줄 등을 사용자가 고쳤을 때 다시 읽는다 (올린 파일 또는 저장한 양식)
  app.post('/api/forms/reanalyze', { preHandler: requireUser }, async (req): Promise<FormAnalysis> => {
    const user = currentUser(req);
    const { uploadId, formId, ...options } = ReanalyzeBody.parse(req.body);
    if (uploadId) {
      const stored = uploads.get(uploadId);
      if (!stored || stored.userId !== user.id) throw badRequest('올린 파일 정보가 만료되었습니다. 양식을 다시 올려 주세요.');
      return analysisFor(uploadId, stored.fileName, stored.file, options);
    }
    if (formId) {
      const row = await getForm(db, formId);
      if (!row || !canUseForm(user, row.department_id)) throw notFound('양식을 찾을 수 없습니다.');
      return analysisFor('', row.file_name, row.file, options);
    }
    throw badRequest('다시 읽을 양식이 없습니다.');
  });

  // 열 설정으로 첫 3명을 채워 본다 (화면 미리보기)
  app.post('/api/forms/preview', { preHandler: requireUser }, async (req): Promise<FormPreview> => {
    const user = currentUser(req);
    const body = PreviewBody.parse(req.body);
    const scope = departmentScope(user);
    if (body.departmentId && scope && !scope.includes(body.departmentId)) throw new HttpError(403, '담당 부서가 아닙니다.');
    const people = await loadFormPeople(db, { year: body.year, scope, departmentId: body.departmentId ?? undefined });
    return {
      columns: body.columns,
      rows: people.slice(0, 3).map((p, i) => body.columns.map((c) => previewText(c.fill, p, i, body.markStyle))),
      total: people.length,
    };
  });

  app.get('/api/forms', { preHandler: requireUser }, async (req): Promise<FormTemplate[]> => {
    const user = currentUser(req);
    const rows = await db
      .selectFrom('form_templates as f')
      .leftJoin('departments as d', 'd.id', 'f.department_id')
      .leftJoin('users as u', 'u.id', 'f.created_by')
      .selectAll('f')
      .select(['d.name as department_name', 'u.name as created_by_name'])
      .orderBy('f.department_id')
      .orderBy('f.name')
      .execute();
    return rows.filter((r) => canUseForm(user, r.department_id)).map((r) => toForm(r, user));
  });

  app.post('/api/forms', { preHandler: requireUser }, async (req): Promise<FormTemplate> => {
    const user = currentUser(req);
    const body = SaveBody.extend({ uploadId: z.string().uuid() }).parse(req.body);
    if (!canEditForm(user, body.departmentId)) throw new HttpError(403, '공용 양식은 관리자만 등록할 수 있습니다. 담당 부서를 골라 주세요.');
    await assertDepartmentExists(body.departmentId);
    const stored = uploads.get(body.uploadId);
    if (!stored || stored.userId !== user.id) throw badRequest('올린 파일 정보가 만료되었습니다. 양식을 다시 올려 주세요.');
    const { id } = await db
      .insertInto('form_templates')
      .values({
        name: cleanText(body.name),
        department_id: body.departmentId,
        file_name: stored.fileName,
        file: stored.file,
        sheet_name: body.layout.sheetName,
        header_first: body.layout.headerFirst,
        header_last: body.layout.headerLast,
        data_first: body.layout.dataFirst,
        footer_row: body.layout.footerRow,
        columns: JSON.stringify(body.columns),
        mark_style: body.markStyle,
        created_by: user.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    uploads.delete(body.uploadId);
    await audit(db, req, 'form.create', { type: 'form', id }, { name: body.name, departmentId: body.departmentId, file: stored.fileName });
    return toForm((await getForm(db, id))!, user);
  });

  app.put('/api/forms/:id', { preHandler: requireUser }, async (req): Promise<FormTemplate> => {
    const user = currentUser(req);
    const { id } = IdParams.parse(req.params);
    const body = SaveBody.parse(req.body);
    const row = await getForm(db, id);
    if (!row || !canUseForm(user, row.department_id)) throw notFound('양식을 찾을 수 없습니다.');
    if (!canEditForm(user, row.department_id) || !canEditForm(user, body.departmentId)) throw new HttpError(403, '이 양식을 고칠 권한이 없습니다.');
    await assertDepartmentExists(body.departmentId);
    await db
      .updateTable('form_templates')
      .set({
        name: cleanText(body.name),
        department_id: body.departmentId,
        sheet_name: body.layout.sheetName,
        header_first: body.layout.headerFirst,
        header_last: body.layout.headerLast,
        data_first: body.layout.dataFirst,
        footer_row: body.layout.footerRow,
        columns: JSON.stringify(body.columns),
        mark_style: body.markStyle,
        updated_at: nowIso(),
      })
      .where('id', '=', id)
      .execute();
    await audit(db, req, 'form.update', { type: 'form', id }, { name: body.name, departmentId: body.departmentId });
    return toForm((await getForm(db, id))!, user);
  });

  app.delete('/api/forms/:id', { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const { id } = IdParams.parse(req.params);
    const row = await getForm(db, id);
    if (!row || !canUseForm(user, row.department_id)) throw notFound('양식을 찾을 수 없습니다.');
    if (!canEditForm(user, row.department_id)) throw new HttpError(403, '이 양식을 지울 권한이 없습니다.');
    await db.deleteFrom('form_templates').where('id', '=', id).execute();
    await audit(db, req, 'form.delete', { type: 'form', id }, { name: row.name });
    return { ok: true };
  });

  // 올린 빈 양식을 그대로 받는다 (개인정보 없음)
  app.get('/api/forms/:id/file', { preHandler: requireUser }, async (req, reply) => {
    const user = currentUser(req);
    const { id } = IdParams.parse(req.params);
    const row = await getForm(db, id);
    if (!row || !canUseForm(user, row.department_id)) throw notFound('양식을 찾을 수 없습니다.');
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', contentDisposition(row.file_name, 'form.xlsx'));
    return reply.send(Buffer.from(row.file));
  });
}
