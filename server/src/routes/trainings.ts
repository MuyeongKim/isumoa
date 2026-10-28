import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REQ_TYPES, type Training, type TrainingDocumentPreview } from '../../../shared/types.ts';
import { currentUser, requireAdmin, requireUser } from '../auth/guard.ts';
import type { TrainingsTable } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { cleanText } from '../lib/text.ts';
import type { Kysely, Selectable } from 'kysely';
import type { DB } from '../db/schema.ts';
import { readTrainingDocument } from '../trainings/document.ts';
import { RosterSelection, trashRoster } from '../roster/trash.ts';

const year = z.number().int().min(2000).max(2100).nullable();

const TrainingFields = z.object({
  name: z.string().trim().min(1, '교육 이름을 입력해 주세요.').max(100),
  category: z.string().trim().max(50).nullable(),
  legalBasis: z.string().trim().max(300).nullable(),
  reqType: z.enum(REQ_TYPES),
  reqValue: z.number().positive('기준 값은 0보다 커야 합니다.').max(1000),
  keywords: z.array(z.string()).max(30),
  fromYear: year,
  toYear: year,
  active: z.boolean(),
  sortOrder: z.number().int(),
  note: z.string().trim().max(500).nullable(),
});

// 새로 만들 때는 이름·기준만 필수. 고칠 때는 보낸 항목만 바꾼다 (기본값을 채우지 않는다)
const CreateTrainingBody = TrainingFields.partial().required({ name: true, reqType: true, reqValue: true });
const UpdateTrainingBody = TrainingFields.partial();

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export function toTraining(row: Selectable<TrainingsTable>): Training {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    legalBasis: row.legal_basis,
    reqType: row.req_type,
    reqValue: row.req_value,
    keywords: JSON.parse(row.keywords) as string[],
    fromYear: row.from_year,
    toYear: row.to_year,
    active: row.active === 1,
    sortOrder: row.sort_order,
    note: row.note,
    deletedAt: row.deleted_at,
  };
}

function cleanKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => cleanText(k)).filter((k) => k !== ''))];
}

const trainingKey = (name: string) => cleanText(name).replace(/\s/g, '').toLowerCase();

async function assertTrainingNameAvailable(db: Kysely<DB>, name: string, exceptId?: number) {
  const existing = await db.selectFrom('trainings').select(['id', 'name', 'deleted_at']).execute();
  const duplicate = existing.find(t => t.id !== exceptId && trainingKey(t.name) === trainingKey(name));
  if (duplicate) throw new HttpError(409, duplicate.deleted_at
    ? '같은 이름의 교육이 휴지통에 있습니다. 삭제한 교육 보기에서 먼저 복원하거나 교육 이름을 바꿔 주세요.'
    : '같은 이름의 교육이 이미 있습니다. 기존 교육을 수정하거나 교육 이름을 바꿔 주세요.');
}

function assertCriterion(reqType: string, reqValue: number) {
  if (reqType === 'count' && !Number.isInteger(reqValue)) throw badRequest('횟수 기준은 1 이상의 정수로 입력해 주세요. 분 단위 교육은 시간 기준을 선택해 주세요.');
}

async function createTraining(db: Kysely<DB>, body: z.infer<typeof CreateTrainingBody>) {
  assertCriterion(body.reqType, body.reqValue);
  if (body.fromYear && body.toYear && body.fromYear > body.toYear) throw badRequest('적용 연도 범위를 확인해 주세요.');
  await assertTrainingNameAvailable(db, body.name);
  const maxOrder = await db.selectFrom('trainings').select(eb => eb.fn.max('sort_order').as('max')).executeTakeFirst();
  return db.insertInto('trainings').values({
    code: `custom-${randomUUID()}`, name: body.name, category: body.category ?? null, legal_basis: body.legalBasis ?? null,
    req_type: body.reqType, req_value: body.reqValue, keywords: JSON.stringify(cleanKeywords(body.keywords ?? [])),
    from_year: body.fromYear ?? null, to_year: body.toYear ?? null, active: body.active === false ? 0 : 1,
    sort_order: body.sortOrder ?? Number(maxOrder?.max ?? 0) + 10, note: body.note ?? null,
  }).returning('id').executeTakeFirstOrThrow();
}

export async function trainingRoutes(app: FastifyInstance, { db, ocr }: Deps) {
  app.get('/api/trainings', { preHandler: requireUser }, async (req): Promise<Training[]> => {
    const { trash } = z.object({ trash: z.enum(['1']).optional() }).parse(req.query);
    if (trash && currentUser(req).role !== 'admin') throw new HttpError(403, '휴지통은 관리자만 볼 수 있습니다.');
    const rows = await db.selectFrom('trainings').selectAll().where('deleted_at', trash ? 'is not' : 'is', null).orderBy('sort_order').orderBy('id').execute();
    return rows.map(toTraining);
  });

  app.post('/api/trainings', { preHandler: requireAdmin }, async (req) => {
    const body = CreateTrainingBody.parse(req.body);
    const created = await db.transaction().execute(trx => createTraining(trx, body));
    await audit(db, req, 'training.create', { type: 'training', id: created.id }, { name: body.name });
    return { id: created.id };
  });

  app.post('/api/trainings/import/parse', { preHandler: requireAdmin }, async (req): Promise<TrainingDocumentPreview> => {
    const file = await req.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) throw badRequest('PDF·HWPX 문서 또는 JPG·JPEG·PNG 사진을 골라 주세요.');
    const fileName = file.filename.normalize('NFC');
    const textPart = file.fields.textLayer;
    const textLayer = textPart && !Array.isArray(textPart) && textPart.type === 'field' ? z.string().max(300_000).parse(textPart.value) : undefined;
    const result = await readTrainingDocument(await file.toBuffer(), fileName, ocr, textLayer);
    const existing = await db.selectFrom('trainings').select(['id', 'name', 'deleted_at']).execute();
    for (const d of result.drafts) {
      const match = existing.find(t => trainingKey(t.name) === trainingKey(d.name));
      if (match) { d.duplicateId = match.id; d.warnings.push(match.deleted_at ? '같은 이름의 교육이 휴지통에 있습니다. 삭제한 교육 보기에서 먼저 복원해 주세요.' : '같은 이름의 교육이 이미 등록되어 있습니다.'); }
    }
    return result;
  });

  app.post('/api/trainings/import/apply', { preHandler: requireAdmin }, async req => {
    const body = z.object({ fileName: z.string().trim().min(1).max(255), trainings: z.array(CreateTrainingBody).min(1).max(200) }).parse(req.body);
    const ids = await db.transaction().execute(async trx => {
      const existing = await trx.selectFrom('trainings').select(['name', 'deleted_at']).execute();
      const names = new Set(existing.map(t => trainingKey(t.name)));
      const created: number[] = [];
      for (const t of body.trainings) {
        const key = trainingKey(t.name);
        if (names.has(key)) {
          const deleted = existing.some(e => trainingKey(e.name) === key && e.deleted_at);
          throw new HttpError(409, deleted ? `교육 "${t.name}"이(가) 휴지통에 있습니다. 삭제한 교육 보기에서 복원해 주세요.` : `교육 "${t.name}"이(가) 이미 있습니다. 선택을 해제하거나 교육 이름을 바꿔 주세요.`);
        }
        names.add(key);
        created.push((await createTraining(trx, { ...t, note: t.note ?? `문서 가져오기: ${body.fileName}` })).id);
      }
      return created;
    });
    await audit(db, req, 'training.import', undefined, { fileName: body.fileName, ids, created: ids.length });
    return { created: ids.length, ids };
  });

  app.patch('/api/trainings/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = UpdateTrainingBody.parse(req.body);
    await db.transaction().execute(async trx => {
      const before = await trx.selectFrom('trainings').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
      if (!before) throw notFound('교육 과정을 찾을 수 없습니다.');
      assertCriterion(body.reqType ?? before.req_type, body.reqValue ?? before.req_value);
      const fromYear = body.fromYear !== undefined ? body.fromYear : before.from_year;
      const toYear = body.toYear !== undefined ? body.toYear : before.to_year;
      if (fromYear && toYear && fromYear > toYear) throw badRequest('적용 연도 범위를 확인해 주세요.');
      // 과거에 중복된 이름이 있더라도 이름을 바꾸지 않는 메모·기준 수정은 허용한다.
      if (body.name !== undefined && trainingKey(body.name) !== trainingKey(before.name)) {
        await assertTrainingNameAvailable(trx, body.name, id);
      }

      await trx
        .updateTable('trainings')
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.legalBasis !== undefined ? { legal_basis: body.legalBasis } : {}),
          ...(body.reqType !== undefined ? { req_type: body.reqType } : {}),
          ...(body.reqValue !== undefined ? { req_value: body.reqValue } : {}),
          ...(body.keywords !== undefined ? { keywords: JSON.stringify(cleanKeywords(body.keywords)) } : {}),
          ...(body.fromYear !== undefined ? { from_year: body.fromYear } : {}),
          ...(body.toYear !== undefined ? { to_year: body.toYear } : {}),
          ...(body.active !== undefined ? { active: body.active ? 1 : 0 } : {}),
          ...(body.sortOrder !== undefined ? { sort_order: body.sortOrder } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          updated_at: nowIso(),
        })
        .where('id', '=', id)
        .execute();
    });
    await audit(db, req, 'training.update', { type: 'training', id }, body);
    return { ok: true };
  });

  for (const restore of [false, true]) {
    app.post(`/api/trainings/bulk-${restore ? 'restore' : 'delete'}`, { preHandler: requireAdmin }, async req => {
      const { ids } = RosterSelection.parse(req.body);
      const result = await trashRoster(db, 'trainings', ids, restore);
      await audit(db, req, restore ? 'training.restore' : 'training.delete', undefined, { ids, ...result });
      return result;
    });
  }

  app.delete('/api/trainings/:id', { preHandler: requireAdmin }, async req => {
    const { id } = IdParams.parse(req.params);
    const result = await trashRoster(db, 'trainings', [id]);
    await audit(db, req, 'training.delete', { type: 'training', id });
    return result;
  });
}
