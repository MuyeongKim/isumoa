import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { OcrEngine } from '../ocr/tesseract.ts';
import { pageImagePath } from '../storage.ts';
import { matchEmployee } from './employeeMatcher.ts';
import { hasUsableText, parseCertificateText } from './parseText.ts';
import { classifiable, loadLearned, loadMatchables, loadTrainings, refreshFlags, scopeOfUser } from './review.ts';
import { classifyTrainings, splitHours } from './trainingClassifier.ts';

// 대기열에서 쪽 하나를 꺼내 처리한다:
//   1) 글자 확보 — PDF 글자층이 쓸 만하면 그대로, 아니면 OCR
//   2) 규칙으로 성명·과정명·이수일·시간 읽기
//   3) 직원 찾기, 교육 정하기 → 검수 대기 이수증 만들기
// 같은 쪽을 다시 처리해도 안전하다 (검수 대기 이수증만 새로 만들고, 확정·제외된 것은 건드리지 않는다).

export interface ProcessDeps {
  db: Kysely<DB>;
  dataDir: string;
  ocr: OcrEngine;
}

export async function processPage(deps: ProcessDeps, pageId: number): Promise<void> {
  const { db } = deps;
  const page = await db
    .selectFrom('pages as p')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .innerJoin('batches as b', 'b.id', 'f.batch_id')
    .select(['p.id', 'p.file_id', 'p.page_no', 'p.text_layer', 'p.ocr_text', 'b.id as batch_id', 'b.year', 'b.created_by'])
    .where('p.id', '=', pageId)
    .executeTakeFirst();
  if (!page) return; // 그사이 지워진 쪽

  await db.updateTable('pages').set({ state: 'processing', error: null }).where('id', '=', pageId).execute();

  let route: 'text' | 'ocr';
  let text: string;
  if (hasUsableText(page.text_layer)) {
    route = 'text';
    text = page.text_layer!;
  } else {
    route = 'ocr';
    // 앞에서 OCR까지 하고 꺼졌다면 그 결과를 다시 쓴다
    text = page.ocr_text ?? (await deps.ocr.recognize(pageImagePath(deps.dataDir, page.file_id, page.page_no, 'image')));
    await db.updateTable('pages').set({ ocr_text: text }).where('id', '=', pageId).execute();
  }

  const parsed = parseCertificateText(text);
  const scope = await scopeOfUser(db, page.created_by);
  const match = matchEmployee({ name: parsed.personName, birth: parsed.personBirth, dept: parsed.personDept, text }, await loadMatchables(db), scope);
  const trainings = await loadTrainings(db);
  const classification = classifyTrainings(parsed.courseTitle, text, classifiable(trainings, page.year), await loadLearned(db));
  const credited = splitHours(parsed.hours, classification.trainingIds.length);

  const certificateId = await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('certificates').select(['id', 'status']).where('page_id', '=', pageId).execute();
    if (existing.some((c) => c.status !== 'draft')) return null;
    await trx.deleteFrom('certificates').where('page_id', '=', pageId).execute();

    const created = await trx
      .insertInto('certificates')
      .values({
        batch_id: page.batch_id,
        page_id: pageId,
        employee_id: match.employeeId,
        person_name: parsed.personName,
        person_birth: parsed.personBirth,
        person_dept: parsed.personDept,
        course_title: parsed.courseTitle,
        provider: parsed.provider,
        cert_no: parsed.certNo,
        completed_on: parsed.completedOn,
        hours: parsed.hours,
        hours_text: parsed.hoursText,
        year: parsed.completedOn ? Number(parsed.completedOn.slice(0, 4)) : page.year,
        source: 'rules',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (classification.trainingIds.length > 0) {
      await trx
        .insertInto('certificate_trainings')
        .values(classification.trainingIds.map((trainingId) => ({ certificate_id: created.id, training_id: trainingId, credited_hours: credited })))
        .execute();
    }
    await trx.updateTable('pages').set({ state: 'done', route, error: null }).where('id', '=', pageId).execute();
    return created.id;
  });

  if (certificateId === null) {
    await db.updateTable('pages').set({ state: 'done', route }).where('id', '=', pageId).execute();
    return;
  }
  await refreshFlags(db, certificateId, scope);
  await db.updateTable('certificates').set({ updated_at: nowIso() }).where('id', '=', certificateId).execute();

  // 같은 직원·이수일로 먼저 들어와 있던 검수 대기 이수증에도 "중복" 표시가 붙도록 다시 계산한다
  if (match.employeeId && parsed.completedOn) {
    const others = await db
      .selectFrom('certificates')
      .select('id')
      .where('id', '!=', certificateId)
      .where('status', '=', 'draft')
      .where('employee_id', '=', match.employeeId)
      .where('completed_on', '=', parsed.completedOn)
      .execute();
    for (const other of others) await refreshFlags(db, other.id, scope);
  }
}
