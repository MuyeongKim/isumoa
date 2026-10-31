import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { CertificateFlag } from '../shared/types.ts';
import { computeFlags, withNotes } from '../server/src/certs/flags.ts';
import { parseCertificateText } from '../server/src/certs/parseText.ts';
import { buildDraft } from '../server/src/certs/processPage.ts';
import { recognizePage, type Recognition } from '../server/src/certs/recognize.ts';
import { unieduCertificateFlags } from '../server/src/certs/trainingClassifier.ts';
import { loadMatchables, loadTrainings } from '../server/src/certs/review.ts';
import { APP_ROOT, loadConfig } from '../server/src/config.ts';
import { runMigrations } from '../server/src/db/migrate.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { createOcrEngine } from '../server/src/ocr/engine.ts';

// 판독 정확도 점검. 이미 올려 둔 이수증 쪽을 지금 판독 방식(PDF 글자층 / OCR + 규칙)으로 다시 읽어 정답과 비교한다.
// DB의 이수증은 바꾸지 않는다 (스캔본은 다른 OCR 엔진으로 읽어 둔 것이면 새로 읽어 그 글자만 저장한다).
//
//   npm run eval -- --truth samples/certs/정답.json       가상 이수증 정답 파일과 비교 (개발용)
//   npm run eval -- --truth confirmed                     서무가 확정한 결과를 정답으로 (현장용)
//   npm run eval -- --truth confirmed --engine tesseract  대체 OCR(tesseract)로 읽었을 때와 비교
//
// 설치본에서는 eval.bat(Windows) / eval.sh(Linux)로 같은 옵션을 쓴다.

const { values: args } = parseArgs({
  options: {
    truth: { type: 'string' },
    batch: { type: 'string' },
    limit: { type: 'string' },
    engine: { type: 'string' },
    json: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help || !args.truth) {
  console.log(`사용법: npm run eval -- --truth <정답.json | confirmed> [옵션]
  --truth confirmed       서무가 확정·제외한 결과를 정답으로 씁니다 (확정·제외한 이수증이 있는 쪽만 점검)
  --truth <파일>          파일·쪽별 정답 JSON (npm run samples:certs가 만드는 정답.json 형식)
  --batch <번호>          이 묶음만 점검
  --limit <n>             앞에서 n쪽만
  --engine <kordoc|tesseract>  스캔본 OCR 엔진 (기본: kordoc, 못 띄우면 tesseract)
  --json <파일>           쪽별 결과를 JSON으로 저장`);
  process.exit(args.help ? 0 : 1);
}

const config = loadConfig();
const { raw, db } = openDatabase(join(config.dataDir, 'app.db'));
runMigrations(raw, { backupDir: join(config.dataDir, 'backups') }); // 서버보다 먼저 새 버전으로 점검할 때
const ocr = await createOcrEngine({ modelDir: join(APP_ROOT, 'vendor', 'ocr-models'), prefer: args.engine === 'tesseract' ? 'tesseract' : 'kordoc' });
if (ocr.fallbackReason) console.log(`※ kordoc을 띄우지 못해 tesseract로 읽습니다: ${ocr.fallbackReason}`);
const trainings = await loadTrainings(db);
const employees = await loadMatchables(db);
const codeOf = new Map(trainings.map((t) => [t.id, t.code]));

interface Expected {
  employeeId: number | null;
  name: string | null;
  completedOn: string;
  hours: number | null;
  codes: string[];
  courseTitle?: string | null;
  provider?: string | null;
  certNo?: string | null;
}
interface PageCase {
  pageId: number;
  label: string;
  year: number;
  /** null이면 이수증이 아닌 쪽(표지·빈 쪽) */
  expected: Expected | null;
}

const pages = await db
  .selectFrom('pages as p')
  .innerJoin('files as f', 'f.id', 'p.file_id')
  .innerJoin('batches as b', 'b.id', 'f.batch_id')
  .select(['p.id', 'p.file_id', 'p.page_no', 'p.text_layer', 'p.ocr_text', 'p.ocr_engine', 'f.original_name', 'b.id as batch_id', 'b.year'])
  .$if(args.batch !== undefined, (qb) => qb.where('b.id', '=', Number(args.batch)))
  .orderBy('b.id', 'desc')
  .orderBy('f.id')
  .orderBy('p.page_no')
  .execute();

const cases: PageCase[] = [];
if (args.truth === 'confirmed') {
  const certs = await db
    .selectFrom('certificates')
    .select(['id', 'page_id', 'status', 'employee_id', 'person_name', 'completed_on', 'hours', 'course_title', 'provider', 'cert_no'])
    .where('status', 'in', ['confirmed', 'excluded'])
    .execute();
  const credits = await db.selectFrom('certificate_trainings').select(['certificate_id', 'training_id']).execute();
  for (const page of pages) {
    const onPage = certs.filter((c) => c.page_id === page.id);
    if (onPage.length === 0) continue;
    const c = onPage.find((x) => x.status === 'confirmed');
    cases.push({
      pageId: page.id,
      label: `#${page.batch_id} ${page.original_name} ${page.page_no}쪽`,
      year: page.year,
      expected: c
        ? {
            employeeId: c.employee_id,
            name: employees.find((e) => e.id === c.employee_id)?.name ?? c.person_name,
            completedOn: c.completed_on!,
            hours: c.hours,
            courseTitle: c.course_title, provider: c.provider, certNo: c.cert_no,
            codes: credits.filter((x) => x.certificate_id === c.id).map((x) => codeOf.get(x.training_id)!),
          }
        : null,
    });
  }
} else {
  type Truth = { file: string; page: number; kind: string; empNo?: string | null; name?: string; trainings?: string[]; completedOn?: string; hours?: number | null; courseTitle?: string | null; provider?: string | null; certNo?: string | null };
  const truth = JSON.parse(readFileSync(args.truth, 'utf8')) as Truth[];
  const seenFiles = new Map<string, number>(); // 같은 파일 이름이 여러 묶음에 있으면 가장 최근 묶음만
  for (const page of pages) {
    const t = truth.find((x) => basename(x.file) === page.original_name && x.page === page.page_no);
    if (!t) continue;
    const firstBatch = seenFiles.get(page.original_name) ?? page.batch_id;
    seenFiles.set(page.original_name, firstBatch);
    if (firstBatch !== page.batch_id) continue;
    if (t.kind === 'certificate' && !t.completedOn) continue; // 정답 없는 사례(같은 파일 다시 낸 것 등)
    cases.push({
      pageId: page.id,
      label: `#${page.batch_id} ${page.original_name} ${page.page_no}쪽`,
      year: page.year,
      expected:
        t.kind !== 'certificate'
          ? null
          : {
              employeeId: employees.find((e) => e.empNo === t.empNo)?.id ?? null,
              name: t.name ?? null,
              completedOn: t.completedOn!,
              hours: t.hours ?? null,
              codes: t.trainings ?? [],
              courseTitle: t.courseTitle, provider: t.provider, certNo: t.certNo,
            },
    });
  }
}
const limited = args.limit ? cases.slice(0, Number(args.limit)) : cases;
if (limited.length === 0) {
  console.log('점검할 쪽이 없습니다. 정답 파일의 파일 이름이 올린 파일과 같은지, 확정한 이수증이 있는지 확인해 주세요.');
  process.exit(1);
}
console.log(`판독 정확도 점검: ${limited.length}쪽 · 스캔본 OCR ${ocr.label}\n`);

// ---------------------------------------------------------------------------
// 쪽마다 읽고 비교

interface PageResult {
  label: string;
  route: string;
  ms: number;
  checks: { field: string; ok: boolean; expected: unknown; got: unknown }[];
  flags: CertificateFlag[];
  /** 판독 단계의 확인 표시가 없는지. 서버의 중복·권한 검사는 별도다. */
  clean: boolean;
  /** 확인 표시 없이 틀린 값이 있음 — 가장 위험한 경우 */
  silentError: boolean;
}

function flagsOf(recognition: Recognition, year: number): { draft: ReturnType<typeof buildDraft>; flags: CertificateFlag[] } {
  const draft = buildDraft(recognition, { trainings, employees, learned: new Map(), scope: null, year });
  const e = employees.find((x) => x.id === draft.match.employeeId);
  const flags = computeFlags({
    status: 'draft',
    personName: draft.read.personName,
    personBirth: draft.read.personBirth,
    personDept: draft.read.personDept,
    employee: e ? { name: e.name, departmentId: e.departmentId, departmentName: e.departmentName, birthDate: e.birthDate, status: e.status } : null,
    ambiguousCount: e ? 0 : draft.match.candidates.length,
    trainings: trainings.filter((t) => draft.trainingIds.includes(t.id)).map((t) => ({ name: t.name, reqType: t.reqType })),
    inactiveMatches: [],
    completedOn: draft.read.completedOn,
    hours: draft.read.hours,
    hoursText: draft.read.hoursText,
    batchYear: year,
    year: draft.read.completedOn ? Number(draft.read.completedOn.slice(0, 4)) : year,
    looksLikeCertificate: parseCertificateText(recognition.text).looksLikeCertificate,
    route: recognition.route,
    duplicateIds: [],
    scope: null,
    today: new Date().toISOString().slice(0, 10),
  });
  flags.push(...unieduCertificateFlags(draft.read.courseTitle, {
    provider: draft.read.provider, year: draft.read.completedOn ? Number(draft.read.completedOn.slice(0, 4)) : year,
    hours: draft.read.hours, fullText: recognition.text,
  }));
  return { draft, flags: withNotes(flags, draft.notes) };
}

const results: PageResult[] = [];
for (const [i, c] of limited.entries()) {
  const page = pages.find((p) => p.id === c.pageId)!;
  const started = Date.now();
  // 학습된 과정명 매핑은 쓰지 않는다 (확정 결과를 정답으로 쓸 때 정답이 새어 들어가므로)
  const recognition = await recognizePage({ db, dataDir: config.dataDir, ocr }, page);
  const ms = Date.now() - started;
  const { draft, flags } = flagsOf(recognition, c.year);
  const clean = flags.every((f) => f.level === 'info');

  const checks: PageResult['checks'] = [];
  if (c.expected === null) {
    // 이수증이 아닌 쪽: 확인 표시(경고 이상) 없이 넘어가면 안 된다
    checks.push({ field: '이수증 아님 표시', ok: !clean, expected: '확인 표시', got: flags.map((f) => f.code).join(',') });
  } else {
    const exp = c.expected;
    const codes = draft.trainingIds.map((id) => codeOf.get(id)!).sort();
    checks.push(
      { field: '직원', ok: draft.match.employeeId === exp.employeeId, expected: exp.name, got: employees.find((e) => e.id === draft.match.employeeId)?.name ?? draft.read.personName },
      { field: '이수일', ok: draft.read.completedOn === exp.completedOn, expected: exp.completedOn, got: draft.read.completedOn },
      { field: '교육', ok: JSON.stringify(codes) === JSON.stringify([...exp.codes].sort()), expected: exp.codes.join(','), got: codes.join(',') },
    );
    for (const [field, key] of [['과정명', 'courseTitle'], ['기관', 'provider'], ['증서번호', 'certNo']] as const) {
      if (exp[key] !== undefined) {
        const normalize = (v: string | null | undefined) => v?.normalize('NFC').replace(/\s+/g, ' ').trim() ?? null;
        checks.push({ field, ok: normalize(draft.read[key]) === normalize(exp[key]), expected: exp[key], got: draft.read[key] });
      }
    }
    if (exp.hours !== null) checks.push({ field: '시간', ok: draft.read.hours === exp.hours, expected: exp.hours, got: draft.read.hours });
  }
  const allOk = checks.every((x) => x.ok);
  results.push({ label: c.label, route: recognition.route, ms, checks, flags, clean, silentError: !allOk && clean });
  const wrong = checks.filter((x) => !x.ok).map((x) => `${x.field}: 정답 ${x.expected} / 읽음 ${x.got}`);
  console.log(
    `[${String(i + 1).padStart(String(limited.length).length)}/${limited.length}] ${allOk ? '맞음' : !allOk && clean ? '틀림(표시 없음!)' : '틀림(확인 표시 있음)'} ${c.label} · ${recognition.route} · ${(ms / 1000).toFixed(1)}초${wrong.length ? `\n      ${wrong.join('\n      ')}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// 요약

const pct = (n: number, d: number) => (d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`);
console.log(`\n── 결과: 스캔본 OCR ${ocr.label} ──`);
for (const field of ['직원', '과정명', '이수일', '교육', '시간', '기관', '증서번호', '이수증 아님 표시']) {
  const all = results.flatMap((r) => r.checks.filter((x) => x.field === field));
  if (all.length) console.log(`${field.padEnd(10, ' ')} ${pct(all.filter((x) => x.ok).length, all.length).padStart(6)}  (${all.filter((x) => x.ok).length}/${all.length})`);
}
const allRight = results.filter((r) => r.checks.every((x) => x.ok)).length;
const silent = results.filter((r) => r.silentError);
console.log(`모두 맞은 쪽   ${pct(allRight, results.length).padStart(6)}  (${allRight}/${results.length})`);
console.log(`판독 정상 후보 ${pct(results.filter((r) => r.clean).length, results.length).padStart(6)}  (판독 단계만 평가, 서버 중복·권한 검사 별도)`);
console.log(`표시 없이 틀림 ${pct(silent.length, results.length).padStart(6)}  (${silent.length}쪽 — 자동 확정 정확도를 뜻하지 않음)`);
const scans = results.filter((r) => r.route === 'ocr');
if (scans.length) console.log(`스캔본 쪽당 시간 ${(scans.reduce((a, r) => a + r.ms, 0) / scans.length / 1000).toFixed(1)}초`);
if (silent.length) console.log(`\n표시 없이 틀린 쪽:\n${silent.map((r) => `  ${r.label}`).join('\n')}`);

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({ engine: ocr.label, scope: '판독 단계 평가: 학습 매핑 미사용, 서버 중복·권한 검사는 별도', results }, null, 2)}\n`);
  console.log(`\n쪽별 결과를 저장했습니다: ${args.json}`);
}
await ocr.close();
await db.destroy();
