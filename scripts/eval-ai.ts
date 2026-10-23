import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import type { CertificateFlag, Training } from '../shared/types.ts';
import { AiHealth } from '../server/src/ai/health.ts';
import { DEFAULT_AI_SETTINGS, loadAiSettings, type AiSettings } from '../server/src/ai/settings.ts';
import { computeFlags, withNotes } from '../server/src/certs/flags.ts';
import { parseCertificateText } from '../server/src/certs/parseText.ts';
import { buildDrafts, type Draft } from '../server/src/certs/processPage.ts';
import { recognizePage, type Recognition } from '../server/src/certs/recognize.ts';
import { loadMatchables, loadTrainings } from '../server/src/certs/review.ts';
import { loadConfig } from '../server/src/config.ts';
import { runMigrations } from '../server/src/db/migrate.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { createTesseractOcr } from '../server/src/ocr/tesseract.ts';

// AI 인식 정확도 점검. 이미 올려 둔 이수증 쪽을 지금(또는 지정한) AI 설정으로 다시 읽어 정답과 비교한다.
// DB의 이수증은 바꾸지 않는다 (스캔본 OCR 결과가 없을 때만 OCR 결과를 저장한다).
//
//   npm run eval -- --truth samples/certs/정답.json          가상 이수증 정답 파일과 비교 (개발용)
//   npm run eval -- --truth confirmed                        서무가 확정한 결과를 정답으로 (현장용)
//   npm run eval -- --truth confirmed --rules                AI 없이 규칙으로만 읽었을 때와 비교
//   npm run eval -- --truth ... --model qwen3.8:27b --vision off --extra '{"reasoning_effort":"none"}'
//
// 설치본에서는 eval.bat(Windows) / eval.sh(Linux)로 같은 옵션을 쓴다.

const { values: args } = parseArgs({
  options: {
    truth: { type: 'string' },
    batch: { type: 'string' },
    limit: { type: 'string' },
    rules: { type: 'boolean', default: false },
    provider: { type: 'string' },
    url: { type: 'string' },
    model: { type: 'string' },
    vision: { type: 'string' },
    extra: { type: 'string' },
    effort: { type: 'string' },
    'api-key-env': { type: 'string' },
    'allow-external': { type: 'boolean', default: false },
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
  --rules                 AI 없이 규칙으로만 읽기
  --provider <openai-compatible|anthropic> --url <주소> --model <모델>
  --vision <auto|on|off>  --extra <JSON>  --effort <low|medium|high>
  --api-key-env <환경변수 이름>   API 키를 담은 환경 변수 (예: ANTHROPIC_API_KEY)
  --allow-external        기관 밖 AI로 실제 이수증을 보내는 것을 허용 (개인정보 주의)
  --json <파일>           쪽별 결과를 JSON으로 저장`);
  process.exit(args.help ? 0 : 1);
}

// ---------------------------------------------------------------------------
// 준비

const config = loadConfig();
const { raw, db } = openDatabase(`${config.dataDir}/app.db`);
runMigrations(raw, { backupDir: `${config.dataDir}/backups` }); // 서버보다 먼저 새 버전으로 점검할 때
const ocr = createTesseractOcr();
const aiHealth = new AiHealth();
const trainings = await loadTrainings(db);
const employees = await loadMatchables(db);
const codeOf = new Map(trainings.map((t) => [t.id, t.code]));

const saved = await loadAiSettings(db);
const settings: AiSettings = args.rules
  ? { ...saved, enabled: false }
  : {
      ...(saved.enabled ? saved : { ...DEFAULT_AI_SETTINGS, ...saved }),
      enabled: true,
      ...(args.provider ? { provider: args.provider as AiSettings['provider'] } : {}),
      ...(args.url ? { baseUrl: args.url } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.vision ? { vision: args.vision as AiSettings['vision'] } : {}),
      ...(args.extra !== undefined ? { extraBody: args.extra } : {}),
      ...(args.effort ? { effort: args.effort as AiSettings['effort'] } : {}),
      ...(args['api-key-env'] ? { apiKey: process.env[args['api-key-env']] ?? null } : {}),
      ...(args['allow-external'] ? { allowExternal: true } : {}),
    };
// 모델을 바꾸면 저장된 연결 테스트 결과(JSON 모드·이미지 읽기)는 맞지 않을 수 있다
if (!args.rules && (args.model || args.url || args.provider) && settings.vision === 'auto') {
  settings.probe = null;
  if (settings.provider !== 'anthropic') console.log('※ 모델을 바꿨으므로 이미지 읽기는 끔으로 봅니다. 이미지로 읽게 하려면 --vision on을 주세요.');
}

interface Expected {
  /** 사번 또는 직원 id로 찾은 직원 */
  employeeId: number | null;
  name: string | null;
  completedOn: string;
  hours: number | null;
  codes: string[];
}
interface PageCase {
  pageId: number;
  label: string;
  year: number;
  /** null이면 이수증이 아닌 쪽(표지·빈 쪽) */
  expected: Expected[] | null;
}

const pages = await db
  .selectFrom('pages as p')
  .innerJoin('files as f', 'f.id', 'p.file_id')
  .innerJoin('batches as b', 'b.id', 'f.batch_id')
  .select(['p.id', 'p.file_id', 'p.page_no', 'p.text_layer', 'p.ocr_text', 'f.original_name', 'b.id as batch_id', 'b.year'])
  .$if(args.batch !== undefined, (qb) => qb.where('b.id', '=', Number(args.batch)))
  .orderBy('b.id', 'desc')
  .orderBy('f.id')
  .orderBy('p.page_no')
  .execute();

const cases: PageCase[] = [];
if (args.truth === 'confirmed') {
  const certs = await db
    .selectFrom('certificates')
    .select(['id', 'page_id', 'status', 'employee_id', 'person_name', 'completed_on', 'hours'])
    .where('status', 'in', ['confirmed', 'excluded'])
    .execute();
  const credits = await db.selectFrom('certificate_trainings').select(['certificate_id', 'training_id']).execute();
  for (const page of pages) {
    const onPage = certs.filter((c) => c.page_id === page.id);
    if (onPage.length === 0) continue;
    const confirmed = onPage.filter((c) => c.status === 'confirmed');
    cases.push({
      pageId: page.id,
      label: `#${page.batch_id} ${page.original_name} ${page.page_no}쪽`,
      year: page.year,
      expected:
        confirmed.length === 0
          ? null
          : confirmed.map((c) => ({
              employeeId: c.employee_id,
              name: employees.find((e) => e.id === c.employee_id)?.name ?? c.person_name,
              completedOn: c.completed_on!,
              hours: c.hours,
              codes: credits.filter((x) => x.certificate_id === c.id).map((x) => codeOf.get(x.training_id)!),
            })),
    });
  }
} else {
  type Truth = { file: string; page: number; kind: string; empNo?: string | null; name?: string; trainings?: string[]; completedOn?: string; hours?: number | null };
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
          : [
              {
                employeeId: employees.find((e) => e.empNo === t.empNo)?.id ?? null,
                name: t.name ?? null,
                completedOn: t.completedOn!,
                hours: t.hours ?? null,
                codes: t.trainings ?? [],
              },
            ],
    });
  }
}
const limited = args.limit ? cases.slice(0, Number(args.limit)) : cases;
if (limited.length === 0) {
  console.log('점검할 쪽이 없습니다. 정답 파일의 파일 이름이 올린 파일과 같은지, 확정한 이수증이 있는지 확인해 주세요.');
  process.exit(1);
}

const mode = !settings.enabled ? '규칙만 (AI 끔)' : `${settings.model} @ ${settings.provider === 'anthropic' ? 'Claude API' : settings.baseUrl} (이미지 읽기: ${settings.vision})`;
console.log(`정확도 점검: ${limited.length}쪽 · ${mode}\n`);

// ---------------------------------------------------------------------------
// 쪽마다 읽고 비교

interface PageResult {
  label: string;
  route: string;
  ms: number;
  aiError: string | null;
  checks: { field: string; ok: boolean; expected: unknown; got: unknown }[];
  /** 확인할 점(오류·경고)이 없어 일괄 확정될 수 있는 이수증이 있었는지 */
  clean: boolean;
  /** 확인 표시 없이 틀린 값이 있음 — 가장 위험한 경우 */
  silentError: boolean;
}

function flagsOf(draft: Draft, recognition: Recognition, year: number): CertificateFlag[] {
  const e = employees.find((x) => x.id === draft.match.employeeId);
  const selected = trainings.filter((t: Training) => draft.trainingIds.includes(t.id));
  const flags = computeFlags({
    status: 'draft',
    personName: draft.rc.personName,
    personBirth: draft.rc.personBirth,
    personDept: draft.rc.personDept,
    employee: e ? { name: e.name, departmentId: e.departmentId, departmentName: e.departmentName, birthDate: e.birthDate, status: e.status } : null,
    ambiguousCount: e ? 0 : draft.match.candidates.length,
    trainings: selected.map((t) => ({ name: t.name, reqType: t.reqType })),
    inactiveMatches: [],
    completedOn: draft.rc.completedOn,
    hours: draft.rc.hours,
    hoursText: draft.rc.hoursText,
    batchYear: year,
    year: draft.rc.completedOn ? Number(draft.rc.completedOn.slice(0, 4)) : year,
    looksLikeCertificate: parseCertificateText(recognition.text).looksLikeCertificate,
    route: recognition.route,
    duplicateIds: [],
    scope: null,
    today: new Date().toISOString().slice(0, 10),
  });
  return withNotes(flags, draft.notes);
}

const results: PageResult[] = [];
for (const [i, c] of limited.entries()) {
  const page = pages.find((p) => p.id === c.pageId)!;
  const started = Date.now();
  const recognition = await recognizePage({ db, dataDir: config.dataDir, ocr, config, aiHealth }, page, trainings, { finalAttempt: true, settings });
  const ms = Date.now() - started;
  // 학습된 과정명 매핑은 쓰지 않는다 (확정 결과를 정답으로 쓸 때 정답이 새어 들어가므로)
  const drafts = buildDrafts(recognition, { trainings, employees, learned: new Map(), scope: null, year: c.year });
  const withFlags = drafts.map((d) => ({ d, flags: flagsOf(d, recognition, c.year) }));
  const isClean = (f: CertificateFlag[]) => f.every((x) => x.level === 'info');

  const checks: PageResult['checks'] = [];
  if (c.expected === null) {
    // 이수증이 아닌 쪽: 확인 표시(경고 이상) 없이 넘어가면 안 된다
    checks.push({ field: '이수증 아님 표시', ok: withFlags.every((x) => !isClean(x.flags)), expected: '확인 표시', got: withFlags.map((x) => x.flags.map((f) => f.code).join(',')).join(' / ') });
  } else {
    for (const exp of c.expected) {
      const found = withFlags.find((x) => x.d.match.employeeId === exp.employeeId) ?? (c.expected.length === 1 ? withFlags[0] : undefined);
      const got = found?.d;
      const codes = got ? got.trainingIds.map((id) => codeOf.get(id)!).sort() : [];
      checks.push(
        { field: '직원', ok: got?.match.employeeId === exp.employeeId, expected: exp.name, got: employees.find((e) => e.id === got?.match.employeeId)?.name ?? got?.rc.personName ?? null },
        { field: '이수일', ok: got?.rc.completedOn === exp.completedOn, expected: exp.completedOn, got: got?.rc.completedOn ?? null },
        { field: '교육', ok: JSON.stringify(codes) === JSON.stringify([...exp.codes].sort()), expected: exp.codes.join(','), got: codes.join(',') },
      );
      if (exp.hours !== null) checks.push({ field: '시간', ok: got?.rc.hours === exp.hours, expected: exp.hours, got: got?.rc.hours ?? null });
    }
  }
  const allOk = checks.every((x) => x.ok);
  const clean = withFlags.some((x) => isClean(x.flags));
  const result: PageResult = {
    label: c.label,
    route: recognition.route,
    ms,
    aiError: recognition.ai?.error ?? null,
    checks,
    clean,
    silentError: !allOk && clean,
  };
  results.push(result);
  const wrong = checks.filter((x) => !x.ok).map((x) => `${x.field}: 정답 ${x.expected} / 읽음 ${x.got}`);
  console.log(
    `[${String(i + 1).padStart(String(limited.length).length)}/${limited.length}] ${allOk ? '맞음' : result.silentError ? '틀림(표시 없음!)' : '틀림(확인 표시 있음)'} ${c.label} · ${recognition.route} · ${(ms / 1000).toFixed(1)}초${result.aiError ? ` · AI 실패: ${result.aiError}` : ''}${wrong.length ? `\n      ${wrong.join('\n      ')}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// 요약

const pct = (n: number, d: number) => (d === 0 ? '-' : `${((n / d) * 100).toFixed(1)}%`);
const fieldNames = ['직원', '이수일', '교육', '시간', '이수증 아님 표시'];
console.log(`\n── 결과: ${mode} ──`);
for (const field of fieldNames) {
  const all = results.flatMap((r) => r.checks.filter((x) => x.field === field));
  if (all.length) console.log(`${field.padEnd(10, ' ')} ${pct(all.filter((x) => x.ok).length, all.length).padStart(6)}  (${all.filter((x) => x.ok).length}/${all.length})`);
}
const allRight = results.filter((r) => r.checks.every((x) => x.ok)).length;
const silent = results.filter((r) => r.silentError);
console.log(`모두 맞은 쪽   ${pct(allRight, results.length).padStart(6)}  (${allRight}/${results.length})`);
console.log(`일괄 확정 대상 ${pct(results.filter((r) => r.clean).length, results.length).padStart(6)}  (확인할 점 없이 '정상'으로 분류된 쪽)`);
console.log(`표시 없이 틀림 ${pct(silent.length, results.length).padStart(6)}  (${silent.length}쪽 — 목표 1% 미만)`);
const aiFailed = results.filter((r) => r.aiError).length;
if (settings.enabled) console.log(`AI 실패       ${pct(aiFailed, results.length).padStart(6)}  (${aiFailed}쪽은 규칙으로 읽음)`);
console.log(`쪽당 평균 시간  ${(results.reduce((a, r) => a + r.ms, 0) / results.length / 1000).toFixed(1)}초`);
if (silent.length) console.log(`\n표시 없이 틀린 쪽:\n${silent.map((r) => `  ${r.label}`).join('\n')}`);

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({ mode, settings: { ...settings, apiKey: settings.apiKey ? '(있음)' : null }, results }, null, 2)}\n`);
  console.log(`\n쪽별 결과를 저장했습니다: ${args.json}`);
}
await ocr.close();
await db.destroy();
