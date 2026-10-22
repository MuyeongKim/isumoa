import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REQ_TYPES, type Training } from '../../../shared/types.ts';
import { requireAdmin, requireUser } from '../auth/guard.ts';
import type { TrainingsTable } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { cleanText } from '../lib/text.ts';
import type { Selectable } from 'kysely';

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
  };
}

function cleanKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => cleanText(k)).filter((k) => k !== ''))];
}

export async function trainingRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/api/trainings', { preHandler: requireUser }, async (): Promise<Training[]> => {
    const rows = await db.selectFrom('trainings').selectAll().orderBy('sort_order').orderBy('id').execute();
    return rows.map(toTraining);
  });

  app.post('/api/trainings', { preHandler: requireAdmin }, async (req) => {
    const body = CreateTrainingBody.parse(req.body);
    if (body.fromYear && body.toYear && body.fromYear > body.toYear) throw badRequest('적용 연도 범위를 확인해 주세요.');
    const maxOrder = await db
      .selectFrom('trainings')
      .select((eb) => eb.fn.max('sort_order').as('max'))
      .executeTakeFirst();
    const created = await db
      .insertInto('trainings')
      .values({
        code: `custom-${Date.now().toString(36)}`,
        name: body.name,
        category: body.category ?? null,
        legal_basis: body.legalBasis ?? null,
        req_type: body.reqType,
        req_value: body.reqValue,
        keywords: JSON.stringify(cleanKeywords(body.keywords ?? [])),
        from_year: body.fromYear ?? null,
        to_year: body.toYear ?? null,
        active: body.active === false ? 0 : 1,
        sort_order: body.sortOrder ?? Number(maxOrder?.max ?? 0) + 10,
        note: body.note ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(db, req, 'training.create', { type: 'training', id: created.id }, { name: body.name });
    return { id: created.id };
  });

  app.patch('/api/trainings/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = UpdateTrainingBody.parse(req.body);
    const before = await db.selectFrom('trainings').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('교육 과정을 찾을 수 없습니다.');
    const fromYear = body.fromYear !== undefined ? body.fromYear : before.from_year;
    const toYear = body.toYear !== undefined ? body.toYear : before.to_year;
    if (fromYear && toYear && fromYear > toYear) throw badRequest('적용 연도 범위를 확인해 주세요.');

    await db
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
    await audit(db, req, 'training.update', { type: 'training', id }, body);
    return { ok: true };
  });
}
