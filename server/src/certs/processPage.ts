import type { Kysely } from 'kysely';
import type { Training } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { matchEmployee, type MatchableEmployee, type MatchResult } from './employeeMatcher.ts';
import { recognizePage, type Recognition, type RecognizeDeps } from './recognize.ts';
import { classifiable, loadLearned, loadMatchables, loadTrainings, refreshFlags, scopeOfUser } from './review.ts';
import { classifyTrainings, splitHours } from './trainingClassifier.ts';

// 대기열에서 쪽 하나를 꺼내 처리한다:
//   1) 값 읽기 (recognize.ts — PDF 글자층 또는 OCR, 규칙 판독)
//   2) 직원 찾기, 교육 정하기 → 검수 대기 이수증 만들기
// 같은 쪽을 다시 처리해도 안전하다 (검수 대기 이수증만 새로 만들고, 확정·제외된 것은 건드리지 않는다).

export type ProcessDeps = RecognizeDeps;

export async function processPage(deps: ProcessDeps, pageId: number): Promise<void> {
  const { db } = deps;
  const page = await db
    .selectFrom('pages as p')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .innerJoin('batches as b', 'b.id', 'f.batch_id')
    .select(['p.id', 'p.file_id', 'p.page_no', 'p.text_layer', 'p.ocr_text', 'p.ocr_engine', 'b.id as batch_id', 'b.year', 'b.created_by'])
    .where('p.id', '=', pageId)
    .executeTakeFirst();
  if (!page) return; // 그사이 지워진 쪽

  await db.updateTable('pages').set({ state: 'processing', error: null }).where('id', '=', pageId).execute();

  const recognition = await recognizePage(deps, page);
  const scope = await scopeOfUser(db, page.created_by);
  const draft = buildDraft(recognition, {
    trainings: await loadTrainings(db),
    employees: await loadMatchables(db),
    learned: await loadLearned(db),
    scope,
    year: page.year,
  });
  const { read, match, trainingIds } = draft;

  const certificateId = await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('certificates').select(['id', 'status']).where('page_id', '=', pageId).execute();
    const done = () => trx.updateTable('pages').set({ state: 'done', route: recognition.route, error: null }).where('id', '=', pageId).execute();
    if (existing.some((c) => c.status !== 'draft')) {
      await done();
      return null;
    }
    await trx.deleteFrom('certificates').where('page_id', '=', pageId).execute();
    const created = await trx
      .insertInto('certificates')
      .values({
        batch_id: page.batch_id,
        page_id: pageId,
        employee_id: match.employeeId,
        person_name: read.personName,
        person_birth: read.personBirth,
        person_dept: read.personDept,
        course_title: read.courseTitle,
        provider: read.provider,
        cert_no: read.certNo,
        completed_on: read.completedOn,
        hours: read.hours,
        hours_text: read.hoursText,
        year: read.completedOn ? Number(read.completedOn.slice(0, 4)) : page.year,
        source: 'rules',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (trainingIds.length > 0) {
      const credited = splitHours(read.hours, trainingIds.length);
      await trx
        .insertInto('certificate_trainings')
        .values(trainingIds.map((trainingId) => ({ certificate_id: created.id, training_id: trainingId, credited_hours: credited })))
        .execute();
    }
    await done();
    return created.id;
  });
  if (certificateId === null) return;

  await refreshFlags(db, certificateId, scope);
  await db.updateTable('certificates').set({ updated_at: nowIso() }).where('id', '=', certificateId).execute();

  // 같은 직원·이수일로 먼저 들어와 있던 검수 대기 이수증에도 "중복" 표시가 붙도록 다시 계산한다
  if (match.employeeId && read.completedOn) {
    const others = await db
      .selectFrom('certificates')
      .select('id')
      .where('id', '!=', certificateId)
      .where('status', '=', 'draft')
      .where('employee_id', '=', match.employeeId)
      .where('completed_on', '=', read.completedOn)
      .execute();
    for (const other of others) await refreshFlags(db, other.id, scope);
  }
}

export interface Draft {
  read: Recognition['read'];
  match: MatchResult;
  trainingIds: number[];
}

/** 읽은 값으로 직원을 찾고 교육을 정한다 (DB에 쓰지 않음 — 정확도 점검 스크립트도 쓴다) */
export function buildDraft(
  recognition: Recognition,
  ctx: { trainings: Training[]; employees: MatchableEmployee[]; learned: Map<string, number[]>; scope: number[] | null; year: number },
): Draft {
  const { read, text } = recognition;
  const match = matchEmployee({ name: read.personName, birth: read.personBirth, dept: read.personDept, text }, ctx.employees, ctx.scope);
  const { trainingIds } = classifyTrainings(read.courseTitle, text, classifiable(ctx.trainings, ctx.year), ctx.learned);
  return { read, match, trainingIds };
}
