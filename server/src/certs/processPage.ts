import type { RuleBundle } from '../../../shared/reviewTools.ts';
import { loadRuleState } from '../rules/service.ts';
import type { Kysely } from 'kysely';
import type { CertificateFlag, Training } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { matchEmployee, type MatchableEmployee, type MatchResult } from './employeeMatcher.ts';
import { recognizePage, type Recognition, type RecognizeDeps } from './recognize.ts';
import { classifiable, loadLearned, loadMatchables, loadTrainings, refreshFlags, scopeOfUser } from './review.ts';
import { classifyTrainings, splitHours } from './trainingClassifier.ts';
import { getSetting, setSetting } from '../db/seed.ts';

// 대기열에서 쪽 하나를 꺼내 처리한다:
//   1) 값 읽기 (recognize.ts — PDF 글자층 또는 OCR, 규칙 판독)
//   2) 직원 찾기, 교육 정하기 → 검수 대기 이수증 만들기
// 같은 쪽을 다시 처리해도 안전하다 (검수 대기 이수증만 새로 만들고, 확정·제외된 것은 건드리지 않는다).

export type ProcessDeps = RecognizeDeps;

export async function processPage(deps: ProcessDeps, pageId: number, expectedGeneration?: number): Promise<void> {
  const { db } = deps;
  const page = await db
    .selectFrom('pages as p')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .innerJoin('batches as b', 'b.id', 'f.batch_id')
    .select(['p.id', 'p.file_id', 'p.page_no', 'p.text_layer', 'p.ocr_text', 'p.ocr_engine', 'p.review_generation', 'b.id as batch_id', 'b.year', 'b.created_by'])
    .where('p.id', '=', pageId)
    .executeTakeFirst();
  if (!page) return; // 그사이 지워진 쪽
  if (expectedGeneration !== undefined && page.review_generation !== expectedGeneration) return;

  const started = await db.updateTable('pages').set({ state: 'processing', error: null }).where('id', '=', pageId)
    .where('review_generation', '=', page.review_generation).executeTakeFirst();
  if (Number(started.numUpdatedRows) === 0) return;

  const rules=await loadRuleState(db);
  const recognition = await recognizePage({...deps,rules}, page);
  const scope = await scopeOfUser(db, page.created_by);
  const draft = buildDraft(recognition, {
    trainings: await loadTrainings(db),
    employees: await loadMatchables(db),
    learned: await loadLearned(db),
    scope,
    year: page.year, rules,
  });
  const { read, match, trainingIds } = draft;

  const certificateId = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('pages').select('review_generation').where('id', '=', pageId).executeTakeFirst();
    if (!current || current.review_generation !== page.review_generation) return null;
    const existing = await trx.selectFrom('certificates').select(['id', 'status']).where('page_id', '=', pageId).execute();
    const done = () => trx.updateTable('pages').set({ state: 'done', route: recognition.route, error: null }).where('id', '=', pageId).execute();
    if (existing.some((c) => c.status !== 'draft')) {
      await done();
      return null;
    }
    const maximum = await trx.selectFrom('certificates').select(eb => eb.fn.max('id').as('maximum')).executeTakeFirst();
    const nextId = Math.max(Number(maximum?.maximum ?? 0), await getSetting(trx, 'certificateIdFloor', 0)) + 1;
    await trx.deleteFrom('certificates').where('page_id', '=', pageId).execute();
    const created = await trx
      .insertInto('certificates')
      .values({
        id: nextId,
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
        notes: JSON.stringify(draft.notes),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await setSetting(trx, 'certificateIdFloor', nextId);
    if (trainingIds.length > 0) {
      const credited = splitHours(read.hours, trainingIds.length);
      await trx
        .insertInto('certificate_trainings')
        .values(trainingIds.map((trainingId) => ({ certificate_id: created.id, training_id: trainingId, credited_hours: credited })))
        .execute();
    }
    await trx.insertInto('certificate_reviews').values({certificate_id:created.id,kind:'recognition',input_hash:'',rule_version:rules.version,model:null,result_json:'{}',created_by:page.created_by}).execute();
    await done();
    return created.id;
  });
  if (certificateId === null) return;

  await refreshFlags(db, certificateId, scope);
  await db.updateTable('certificates').set({ updated_at: nowIso() }).where('id', '=', certificateId).execute();

  // 파일 바이트가 달라도 증서번호 또는 직원·이수일이 같은 대기 건에 중복 표시를 갱신한다.
  if (match.employeeId && (read.completedOn || (read.certNo && read.provider))) {
    const others = await db
      .selectFrom('certificates')
      .select('id')
      .where('id', '!=', certificateId)
      .where('status', '=', 'draft')
      .where('employee_id', '=', match.employeeId)
      .where(eb => eb.or([
        ...(read.completedOn ? [eb('completed_on', '=', read.completedOn)] : []),
        ...(read.certNo && read.provider ? [eb.and([eb('cert_no', '=', read.certNo), eb('provider', '=', read.provider)])] : []),
      ]))
      .execute();
    for (const other of others) await refreshFlags(db, other.id, scope);
  }
}

export interface Draft {
  read: Recognition['read'];
  match: MatchResult;
  trainingIds: number[];
  notes: CertificateFlag[];
}

/** 읽은 값으로 직원을 찾고 교육을 정한다 (DB에 쓰지 않음 — 정확도 점검 스크립트도 쓴다) */
export function buildDraft(
  recognition: Recognition,
  ctx: { trainings: Training[]; employees: MatchableEmployee[]; learned: Map<string, number[]>; scope: number[] | null; year: number; rules?:RuleBundle },
): Draft {
  const { read, text } = recognition;
  const match = matchEmployee({ name: read.personName, birth: read.personBirth, dept: read.personDept, text }, ctx.employees, ctx.scope);
  const classification = read.looksLikeCertificate
    ? classifyTrainings(read.courseTitle, text, classifiable(ctx.trainings, ctx.year), ctx.learned, {
      provider: read.provider, year: read.completedOn ? Number(read.completedOn.slice(0, 4)) : ctx.year, rules:ctx.rules,
    })
    : { trainingIds: [], source: null, inactiveMatches: [] };
  const notes = [...read.notes];
  if(classification.source==='pack-custom')notes.push({code:'custom-rule-match',level:'warning',message:'사용자 규칙으로 교육 후보를 연결했습니다. 원본과 인정 범위를 확인해 주세요.'});
  if(classification.source==='pack-official')notes.push({code:'official-rule-match',level:'info',message:'설치한 공식 규칙으로 교육 후보를 연결했습니다. 원본과 대조해 주세요.'});
  if ('scopeConflicts' in classification && classification.scopeConflicts?.length) {
    notes.push({ code: 'training-scope-conflict', level: 'warning', message: `서로 다른 주제의 기존 연결을 자동 적용하지 않았습니다. ${classification.scopeConflicts.join(' ')}` });
  }
  if (classification.source === 'catalog' && classification.trainingIds.length === 1) {
    notes.push({ code: 'training-catalog-match', level: 'info', message: '국립통일교육원 공식 공공과정 목록과 발급기관을 대조해 통일교육 후보로 연결했습니다. 직원·날짜·시간은 원본과 대조해 주세요.' });
  } else if (classification.source === 'name') {
    const training = ctx.trainings.find(t => t.id === classification.trainingIds[0]);
    notes.push({ code: 'training-name-suggestion', level: 'warning', message: `교육과정 이름을 비교해 '${training?.name ?? '교육'}'을 후보로 채웠습니다. 교육 내용과 인정 범위를 확인해 주세요.` });
  } else if (classification.source === 'text') {
    notes.push({ code: 'training-text-suggestion', level: 'warning', message: '과정명을 읽지 못해 문서 전체의 단어로 교육을 채웠습니다. 원본의 과정명과 인정 교육을 확인해 주세요.' });
  }
  if ('ignoredKeywords' in classification && classification.ignoredKeywords?.length) {
    notes.push({ code: 'training-weak-keyword', level: 'warning', message: `'${classification.ignoredKeywords.join(', ')}' 같은 공통 단어만 일치해 교육을 자동 선택하지 않았습니다. 현재 관리 대상인지 확인해 주세요.` });
  }
  return { read, match, trainingIds: classification.trainingIds, notes };
}
