import type { Kysely } from 'kysely';
import type { CertificateFlag, Training } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { matchEmployee, nameDistance, type MatchableEmployee, type MatchResult } from './employeeMatcher.ts';
import { nameKey } from '../lib/text.ts';
import { recognizePage, type Difference, type Recognition, type RecognizeDeps, type RecognizedCertificate } from './recognize.ts';
import { classifiable, loadLearned, loadMatchables, loadTrainings, refreshFlags, scopeOfUser } from './review.ts';
import { classifyTrainings, splitHours } from './trainingClassifier.ts';

// 대기열에서 쪽 하나를 꺼내 처리한다:
//   1) 값 읽기 (recognize.ts — 글자/OCR, 규칙, AI)
//   2) 직원 찾기, 교육 정하기 → 검수 대기 이수증 만들기 (한 쪽에 여러 장이면 여러 건)
// 같은 쪽을 다시 처리해도 안전하다 (검수 대기 이수증만 새로 만들고, 확정·제외된 것은 건드리지 않는다).

export type ProcessDeps = RecognizeDeps;

const warning = (code: string, message: string): CertificateFlag => ({ code, level: 'warning', message });
const info = (code: string, message: string): CertificateFlag => ({ code, level: 'info', message });

export async function processPage(deps: ProcessDeps, pageId: number, options: { finalAttempt: boolean } = { finalAttempt: true }): Promise<void> {
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

  const trainings = await loadTrainings(db);
  const recognition = await recognizePage(deps, page, trainings, options);

  const scope = await scopeOfUser(db, page.created_by);
  const drafts = buildDrafts(recognition, { trainings, employees: await loadMatchables(db), learned: await loadLearned(db), scope, year: page.year });

  const aiFields = recognition.ai
    ? { ai_raw: recognition.ai.raw, ai_model: recognition.ai.model, ai_ms: recognition.ai.ms, ai_error: recognition.ai.error, prompt_version: recognition.ai.promptVersion }
    : { ai_raw: null, ai_model: null, ai_ms: null, ai_error: null, prompt_version: null };

  const createdIds = await db.transaction().execute(async (trx) => {
    const existing = await trx.selectFrom('certificates').select(['id', 'status']).where('page_id', '=', pageId).execute();
    if (existing.some((c) => c.status !== 'draft')) {
      await trx.updateTable('pages').set({ state: 'done', route: recognition.route, error: null, ...aiFields }).where('id', '=', pageId).execute();
      return [];
    }
    await trx.deleteFrom('certificates').where('page_id', '=', pageId).execute();

    const ids: number[] = [];
    for (const d of drafts) {
      const created = await trx
        .insertInto('certificates')
        .values({
          batch_id: page.batch_id,
          page_id: pageId,
          employee_id: d.match.employeeId,
          person_name: d.rc.personName,
          person_birth: d.rc.personBirth,
          person_dept: d.rc.personDept,
          course_title: d.rc.courseTitle,
          provider: d.rc.provider,
          cert_no: d.rc.certNo,
          completed_on: d.rc.completedOn,
          hours: d.rc.hours,
          hours_text: d.rc.hoursText,
          year: d.rc.completedOn ? Number(d.rc.completedOn.slice(0, 4)) : page.year,
          source: d.rc.source,
          ai_codes: JSON.stringify(d.rc.aiCodes),
          notes: JSON.stringify(d.notes),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (d.trainingIds.length > 0) {
        const credited = splitHours(d.rc.hours, d.trainingIds.length);
        await trx
          .insertInto('certificate_trainings')
          .values(d.trainingIds.map((trainingId) => ({ certificate_id: created.id, training_id: trainingId, credited_hours: credited })))
          .execute();
      }
      ids.push(created.id);
    }
    await trx.updateTable('pages').set({ state: 'done', route: recognition.route, error: null, ...aiFields }).where('id', '=', pageId).execute();
    return ids;
  });

  for (const id of createdIds) {
    await refreshFlags(db, id, scope);
    await db.updateTable('certificates').set({ updated_at: nowIso() }).where('id', '=', id).execute();
  }

  // 같은 직원·이수일로 먼저 들어와 있던 검수 대기 이수증에도 "중복" 표시가 붙도록 다시 계산한다
  for (const d of drafts) {
    if (!d.match.employeeId || !d.rc.completedOn) continue;
    const others = await db
      .selectFrom('certificates')
      .select('id')
      .where('id', 'not in', createdIds.length ? createdIds : [0])
      .where('status', '=', 'draft')
      .where('employee_id', '=', d.match.employeeId)
      .where('completed_on', '=', d.rc.completedOn)
      .execute();
    for (const other of others) await refreshFlags(db, other.id, scope);
  }
}

export interface Draft {
  rc: RecognizedCertificate;
  match: MatchResult;
  trainingIds: number[];
  /** 인식할 때 남긴 확인할 점 (AI·규칙 차이, 교육 충돌 등) */
  notes: CertificateFlag[];
}

/** 읽은 값마다 직원을 찾고 교육을 정한다 (DB에 쓰지 않음 — 정확도 점검 스크립트도 쓴다) */
export function buildDrafts(
  recognition: Recognition,
  ctx: { trainings: Training[]; employees: MatchableEmployee[]; learned: Map<string, number[]>; scope: number[] | null; year: number },
): Draft[] {
  const single = recognition.certificates.length === 1;
  return recognition.certificates.map((rc) => {
    // 한 쪽에 여러 장이면 글 전체에서 이름을 찾지 않는다 (다른 사람 이름이 잡힐 수 있다)
    const text = single ? recognition.text : '';
    const match = matchFor(rc, text, ctx.employees, ctx.scope);
    const { trainingIds, notes } = decideTrainings(rc, text, ctx.trainings, ctx.year, ctx.learned);
    return { rc, match, trainingIds, notes: [...rc.notes, ...differenceNotes(rc, match, ctx.employees), ...notes] };
  });
}

const FIELD_LABELS: Record<Difference['field'], string> = { name: '이름', date: '이수일', hours: '교육시간' };

/**
 * AI와 글자 판독(PDF 글자·OCR)이 다르게 읽은 칸을 확인할 점으로 만든다.
 * 이름만은 예외가 있다: 스캔본 OCR이 이름을 망가뜨리는 일이 잦아서,
 *  - AI가 읽은 이름이 직원 명단과 정확히 맞고
 *  - 글자 판독의 이름은 명단의 누구와도 맞지 않고
 *  - 명단에 비슷한 이름(자모 2개 이내 차이)의 다른 직원이 없으면
 * AI 값이 맞다고 보고 안내(파랑)로만 남긴다. 그 밖에는 주황 경고로 원본 대조를 요청한다.
 */
function differenceNotes(rc: RecognizedCertificate, match: MatchResult, employees: MatchableEmployee[]): CertificateFlag[] {
  const name = rc.differences.find((d) => d.field === 'name');
  const nameExplained =
    !!name &&
    match.method === 'exact' &&
    match.employeeId !== null &&
    nameKey(name.ai) === nameKey(rc.personName ?? '') &&
    !employees.some((e) => e.nameKey === nameKey(name.rules)) &&
    !employees.some((e) => e.id !== match.employeeId && nameDistance(e.name, name.ai) <= 2);
  const shown = rc.differences.filter((d) => !(nameExplained && d === name));
  const notes: CertificateFlag[] = [];
  if (shown.length > 0) {
    notes.push(
      warning('ai-differs', `AI와 글자 판독이 다르게 읽었습니다 — ${shown.map((d) => `${FIELD_LABELS[d.field]} AI '${d.ai}' / 글자 '${d.rules}'`).join(', ')}. 원본과 대조해 주세요.`),
    );
  }
  if (nameExplained) {
    notes.push(info('ocr-name', `OCR은 이름을 '${name!.rules}'(으)로 읽었지만, AI가 읽은 '${name!.ai}'이(가) 직원 명단과 정확히 맞고 비슷한 이름의 직원이 없어 AI 값을 썼습니다.`));
  }
  return notes;
}

/** AI 이름으로 직원을 못 찾았는데 규칙이 다른 이름을 읽었으면 그 이름으로도 찾아본다 */
function matchFor(rc: RecognizedCertificate, text: string, employees: MatchableEmployee[], scope: number[] | null): MatchResult {
  const match = matchEmployee({ name: rc.personName, birth: rc.personBirth, dept: rc.personDept, text }, employees, scope);
  if (match.method === 'exact' || !rc.rulesName || rc.rulesName === rc.personName) return match;
  const byRules = matchEmployee({ name: rc.rulesName, birth: rc.personBirth, dept: rc.personDept, text }, employees, scope);
  return byRules.method === 'exact' ? byRules : match;
}

/**
 * 교육 정하기: ① 서무가 확정하며 쌓인 매핑 → ② 키워드 → ③ 둘 다 없을 때만 AI가 고른 교육.
 * 키워드로 정한 교육과 AI가 고른 교육이 다르면 확인 표시를 단다.
 */
function decideTrainings(
  rc: RecognizedCertificate,
  text: string,
  trainings: Training[],
  year: number,
  learned: Map<string, number[]>,
): { trainingIds: number[]; notes: CertificateFlag[] } {
  const usable = classifiable(trainings, year);
  const classification = classifyTrainings(rc.courseTitle, text, usable, learned);
  const applicable = new Set(usable.filter((t) => t.applicable).map((t) => t.id));
  const byCode = new Map(trainings.map((t) => [t.code.toLowerCase(), t]));
  const aiTrainings = [...new Set(rc.aiCodes.map((c) => byCode.get(c.trim().toLowerCase())).filter((t): t is Training => !!t && applicable.has(t.id)))];
  const names = (ids: number[]) => ids.map((id) => trainings.find((t) => t.id === id)?.name ?? `#${id}`).join(', ');

  if (classification.trainingIds.length === 0) {
    if (aiTrainings.length === 0) return { trainingIds: [], notes: [] };
    const ids = aiTrainings.map((t) => t.id);
    return {
      trainingIds: ids,
      notes: [warning('training-by-ai', `과정명으로 교육을 정하지 못해 AI가 고른 교육(${names(ids)})으로 넣었습니다. 맞는지 확인해 주세요.`)],
    };
  }
  if (classification.source === 'learned' || aiTrainings.length === 0) return { trainingIds: classification.trainingIds, notes: [] };

  const same =
    aiTrainings.length === classification.trainingIds.length && aiTrainings.every((t) => classification.trainingIds.includes(t.id));
  return {
    trainingIds: classification.trainingIds,
    notes: same
      ? []
      : [
          warning(
            'training-conflict',
            `과정명으로 정한 교육(${names(classification.trainingIds)})과 AI가 고른 교육(${names(aiTrainings.map((t) => t.id))})이 다릅니다. 맞는 교육을 확인해 주세요.`,
          ),
        ],
  };
}
