import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { ReviewResetPreview, ReviewResetResult, SessionUser } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { HttpError, notFound } from '../lib/errors.ts';

async function resetSelection(db: Kysely<DB>, user: SessionUser, batchId?: number) {
  const batch = batchId ? await db.selectFrom('batches').selectAll().where('id', '=', batchId).executeTakeFirst() : undefined;
  if (batchId && !batch) throw notFound('묶음을 찾을 수 없습니다.');
  if (batch && user.role !== 'admin' && batch.created_by !== user.id) throw new HttpError(403, '내가 올린 묶음만 초기화할 수 있습니다.');
  const pages = await db.selectFrom('pages as p').innerJoin('files as f', 'f.id', 'p.file_id').innerJoin('batches as b', 'b.id', 'f.batch_id')
    .select(['p.id', 'p.state', 'p.review_generation'])
    .$if(batchId !== undefined, query => query.where('b.id', '=', batchId!))
    .$if(user.role !== 'admin', query => query.where('b.created_by', '=', user.id))
    .where(eb => eb.not(eb.exists(eb.selectFrom('certificates as c').select('c.id').whereRef('c.page_id', '=', 'p.id').where('c.status', '!=', 'draft'))))
    .where(eb => eb.or([
      eb('p.state', 'in', ['queued', 'processing', 'error']),
      eb.exists(eb.selectFrom('certificates as c').select('c.id').whereRef('c.page_id', '=', 'p.id').where('c.status', '=', 'draft')),
    ])).orderBy('p.id').execute();
  const ids = pages.map(page => page.id);
  const certificates = ids.length ? await db.selectFrom('certificates').selectAll().where('page_id', 'in', ids).where('status', '=', 'draft').orderBy('id').execute() : [];
  const token = createHash('sha256').update(JSON.stringify({ user: user.id, batch: batchId ?? null,
    pages: pages.map(page => [page.id, page.review_generation]), manual: certificates.filter(c => c.source === 'manual') })).digest('hex');
  const preview: ReviewResetPreview = { batchId: batchId ?? null, scopeLabel: batch ? `묶음 #${batch.id}${batch.title ? ` · ${batch.title}` : ''}` : user.role === 'admin' ? '전체 묶음' : '내가 올린 묶음',
    drafts: certificates.length, incompletePages: pages.filter(page => page.state !== 'done').length, pages: pages.length, token };
  return { ids, preview };
}

export async function previewReviewReset(db: Kysely<DB>, user: SessionUser, batchId?: number): Promise<ReviewResetPreview> {
  return (await resetSelection(db, user, batchId)).preview;
}

/** 판독 결과만 비우고, 원본·확정·제외·명단·과정·확정 매핑은 보존한다. */
export async function resetReviewDrafts(db: Kysely<DB>, user: SessionUser, token: string, batchId?: number): Promise<ReviewResetResult> {
  return db.transaction().execute(async trx => {
    const { ids, preview } = await resetSelection(trx, user, batchId);
    if (preview.token !== token) throw new HttpError(409, '초기화 범위의 자료가 바뀌었습니다. 갱신된 건수를 확인한 뒤 다시 눌러 주세요.');
    if (!ids.length) return { removed: 0, resetPages: 0 };
    const maximum = await trx.selectFrom('certificates').select(eb => eb.fn.max('id').as('maximum')).executeTakeFirst();
    await setSetting(trx, 'certificateIdFloor', Math.max(Number(maximum?.maximum ?? 0), await getSetting(trx, 'certificateIdFloor', 0)));
    // 결과 작성 직전에도 세대를 검사하므로 이미 읽고 있던 작업이 뒤늦게 결과를 되살리지 못한다.
    await trx.updateTable('pages').set(eb => ({ review_generation: eb('review_generation', '+', 1), state: 'done', error: null })).where('id', 'in', ids).execute();
    await trx.deleteFrom('jobs').where('page_id', 'in', ids).execute();
    const removed = await trx.deleteFrom('certificates').where('page_id', 'in', ids).where('status', '=', 'draft').executeTakeFirst();
    return { removed: Number(removed.numDeletedRows), resetPages: ids.length };
  });
}
