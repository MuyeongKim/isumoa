// 합성 신규 서식 검증. 실제 직원·기관 자료나 운영 DB를 읽지 않는다.
// 실행: node --disable-warning=ExperimentalWarning scripts/validation/session1-recognition.ts <새 출력 폴더>
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { CertificateFlag } from '../../shared/types.ts';
import { DEPLOYMENT_TRAININGS } from '../../shared/deploymentCatalog.ts';
import { joinPdfTextItems, type PdfTextItem } from '../../shared/pdfText.ts';
import { processPage } from '../../server/src/certs/processPage.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';
import { runMigrations } from '../../server/src/db/migrate.ts';
import { seedDefaults } from '../../server/src/db/seed.ts';
import { createOcrEngine } from '../../server/src/ocr/engine.ts';
import { type Op, drawMemo } from '../fixtures/certificate.ts';
import { renderScanJpeg, renderTextPdf, jpegsToPdf } from '../fixtures/render.ts';

const holdout = process.argv[3] === 'holdout';
const out = process.argv[2] ? resolve(process.argv[2]) : null;
if (!out) throw Error('새 출력 폴더를 지정하세요.');
if (existsSync(join(out, 'app.db')) || existsSync(join(out, 'truth.json'))) throw Error('기존 결과를 덮어쓰지 않습니다. 새 폴더를 지정하세요.');
mkdirSync(out, { recursive: true }); mkdirSync(join(out, 'files'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const people = [{ name: '홍길동', birth: '1981-03-02', dept: '가상총무과' }, { name: '김하나', birth: '1990-07-15', dept: '가상기획과' }];
type Truth = { name: string; employee: number | null; title: string; provider: string; certNo: string; date: string; hours: number | null; codes: string[]; hold?: boolean };
type Case = { id: string; route: 'text' | 'ocr'; layout: number; ops: Op[]; expected: Truth | null };
function layout(t: Truth, n: number, person: typeof people[number]): Op[] {
  const facts = [['성명', t.name], ['생년월일', person.birth], ['소속', person.dept], ['과정명', t.title], ['이수일', t.date], ['교육시간', t.hours === null ? '2차시' : `${t.hours}시간`], ['교육기관', t.provider], ['증서번호', t.certNo]];
  const text = (s: string, x: number, y: number, size = 15): Op => ({ kind: 'text', text: s, x, y, size });
  if (holdout) {
    const aliases: Record<string, string> = { '성명': '성 명', '생년월일': '생 년 월 일', '소속': '소속부서', '과정명': '연수명', '이수일': '수료일자', '교육시간': '학습인정시간', '교육기관': '시행기관', '증서번호': '수료번호' };
    const ordered = [facts[7], facts[0], facts[2], facts[3], facts[5], facts[4], facts[1], facts[6]];
    return [text('교육 이수 확인서', 130, 130, 28), ...ordered.flatMap(([k, v], i) => [text(aliases[k], 65, 230 + i * 58, 13), text(':', 205, 230 + i * 58, 13), text(v, 225, 230 + i * 58, 13)]), text('위 교육을 수료하였음을 확인합니다.', 80, 760, 14)];
  }
  const head: Op[] = [{ kind: 'rect', x: 35, y: 40, w: 525, h: 760, lineWidth: 1.2 }, text('가상 검증용 교육 이수증', 80, 100, 24)];
  if (n % 3 === 0) return [...head, ...facts.flatMap(([k, v], i) => [text(k, 70, 190 + 60 * i, 13), text(v, 210, 190 + 60 * i, 13)]), text('위 교육을 이수하였음을 증명합니다.', 80, 750, 14)];
  if (n % 3 === 1) return [...head, ...facts.map(([k, v], i) => text(`${k} : ${v}`, 70, 200 + 57 * i, 13)), text('위 사람은 본 교육을 수료하였습니다.', 70, 735, 14)];
  return [...head, ...facts.flatMap(([k, v], i) => [text(k, 70, 175 + 68 * i, 11), text(v, 70, 196 + 68 * i, 14)]), text('성실히 이수하였기에 증명합니다.', 70, 770, 13)];
}
const cases: Case[] = [];
for (const route of ['text', 'ocr'] as const) for (const [i, training] of DEPLOYMENT_TRAININGS.entries()) {
  const person = people[i % 2];
  const expected: Truth = { name: person.name, employee: i % 2 + 1, title: training.name, provider: '가상미래교육원', certNo: `SYN-${route === 'text' ? 'A' : 'B'}-${i + 1}`, date: `2026-${route === 'text' ? '05' : '06'}-${String(i + 1).padStart(2, '0')}`, hours: training.reqValue, codes: [training.code] };
  cases.push({ id: `${route}-${i + 1}`, route, layout: i % 3, ops: layout(expected, i, person), expected });
}
for (const [i, title] of ['정보보안 실무', '긴급자동차 교통안전', '개인정보보호 교육', '감염병 예방관리및위기대응'].entries()) {
  const expected: Truth = { name: i === 2 ? '최가상' : people[0].name, employee: i === 2 ? null : 1, title, provider: '가상미래교육원', certNo: `SYN-H-${i}`, date: `2026-07-0${i + 1}`, hours: i === 3 ? null : 1, codes: i < 2 ? [] : [i === 2 ? 'privacy' : 'infection-prevention'], hold: true };
  cases.push({ id: `hold-${i + 1}`, route: 'text', layout: 1, ops: layout(expected, 1, people[0]), expected });
}
for (const [i, lines] of [ ['교육 안내문', '성명 : 홍길동', '소속 : 가상총무과', '과정명 : 개인정보보호 교육', '신청기간 : 2026-05-01 ~ 2026-05-31'], ['참가 신청서', '성명 : 김하나', '교육시간 : 1시간', '교육명 : 감염병 예방 교육'], ['제출 표지', '가상총무과 법정교육 수료증 모음', '제출일 : 2026-10-20'], ['2026년 교육 계획', '정보공개 교육 1시간', '생명지킴이 교육 1시간'] ].entries()) cases.push({ id: `noncertificate-${i + 1}`, route: 'text', layout: -1, ops: drawMemo(lines), expected: null });
writeFileSync(join(out, 'truth.json'), JSON.stringify(cases.map(({ ops, ...c }) => c), null, 2));
const { raw, db } = openDatabase(join(out, 'app.db')); runMigrations(raw); await seedDefaults(db);
await db.deleteFrom('course_mappings').execute(); // 정답 누출 방지: 기본/사용자 확정 매핑 미사용
await db.insertInto('users').values({ id: 1, login_id: 'synthetic-only', name: '가상 검증', role: 'admin', password_hash: 'not-a-login-account', locked_until: null, last_login_at: null }).execute();
for (const [i, p] of people.entries()) {
  await db.insertInto('departments').values({ id: i + 1, name: p.dept }).execute();
  await db.insertInto('employees').values({ id: i + 1, name: p.name, name_key: p.name, emp_no: `SYN-${i + 1}`, department_id: i + 1, birth_date: p.birth, position: null, emp_type: null, hired_on: null, left_on: null, note: '실존 인물 아님' }).execute();
}
await db.insertInto('batches').values({ id: 1, year: 2026, title: '합성 신규 서식', created_by: 1 }).execute();
const ocr = await createOcrEngine({ modelDir: resolve('vendor/ocr-models') });
type Check = { field: string; expected: unknown; got: unknown; ok: boolean };
const results: { id: string; route: string; layout: number; ms: number; checks: Check[]; clean: boolean; flags: CertificateFlag[]; silentError: boolean }[] = [];
for (const route of ['text', 'ocr'] as const) {
  const selected = cases.filter(c => c.route === route);
  const jpegs = await Promise.all(selected.map((c, i) => renderScanJpeg(c.ops, { dpi: 180, angle: route === 'ocr' ? (i % 3 - 1) * 0.8 : 0, noise: route === 'ocr' ? 0.4 : 0, seed: 3100 + i })));
  const pdf = route === 'text' ? await renderTextPdf(selected.map(c => c.ops)) : await jpegsToPdf(jpegs);
  writeFileSync(join(out, `${route}.pdf`), pdf);
  const file = await db.insertInto('files').values({ batch_id: 1, original_name: `${route}.pdf`, stored_name: `${route}.pdf`, mime: 'application/pdf', size: pdf.length, sha256: sha(pdf), page_count: selected.length }).returning('id').executeTakeFirstOrThrow();
  writeFileSync(join(out, 'files', `${route}.pdf`), pdf); mkdirSync(join(out, 'pages', String(file.id)), { recursive: true });
  const pdfDoc = route === 'text' ? await getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise : null;
  for (const [i, c] of selected.entries()) {
    writeFileSync(join(out, 'pages', String(file.id), `${i + 1}.jpg`), jpegs[i]);
    const content = pdfDoc ? await (await pdfDoc.getPage(i + 1)).getTextContent() : null;
    const text = content ? joinPdfTextItems(content.items.filter(v => 'str' in v) as PdfTextItem[]) : null;
    const page = await db.insertInto('pages').values({ file_id: file.id, page_no: i + 1, width: 1488, height: 2105, text_layer: text, ocr_text: null, ocr_engine: null, route: null, error: null }).returning('id').executeTakeFirstOrThrow();
    const started = Date.now(); await processPage({ db, dataDir: out, ocr }, page.id);
    const processed = await db.selectFrom('pages').select('route').where('id', '=', page.id).executeTakeFirstOrThrow();
    const got = await db.selectFrom('certificates').selectAll().where('page_id', '=', page.id).executeTakeFirstOrThrow();
    const credits = await db.selectFrom('certificate_trainings as c').innerJoin('trainings as t', 't.id', 'c.training_id').select('t.code').where('c.certificate_id', '=', got.id).execute();
    const flags = JSON.parse(got.flags); const clean = flags.every((f: {level:string}) => f.level === 'info');
    const norm = (v: unknown) => typeof v === 'string' ? v.normalize('NFC').replace(/\s+/g, '') : v;
    const e = c.expected;
    const checks: Check[] = e ? [['직원', e.employee, got.employee_id], ['과정명', e.title, got.course_title], ['이수일', e.date, got.completed_on], ['시간', e.hours, got.hours], ['기관', e.provider, got.provider], ['증서번호', e.certNo, got.cert_no], ['교육', e.codes.slice().sort().join(','), credits.map(x=>x.code).sort().join(',')]].map(([field, expected, value])=>({ field: String(field), expected, got: value, ok: norm(expected) === norm(value) })) : [{ field: '이수증 아님 보류', expected: true, got: !clean, ok: !clean }];
    if (e?.hold) checks.push({ field: '불확실 사례 보류', expected: true, got: !clean, ok: !clean });
    const row = { id: c.id, route: processed.route ?? route, layout: c.layout, ms: Date.now()-started, checks, clean, flags, silentError: !checks.every(x=>x.ok) && clean };
    results.push(row); console.log(c.id, checks.every(x=>x.ok) ? '일치' : row.silentError ? '오류-표시없음' : '오류-보류', `${row.ms}ms`);
    writeFileSync(join(out, 'results.partial.json'), JSON.stringify(results, null, 2));
  }
  await pdfDoc?.cleanup();
}
const fields = [...new Set(results.flatMap(r=>r.checks.map(x=>x.field)))].map(field=>{const checks=results.flatMap(r=>r.checks.filter(x=>x.field===field));return {field,correct:checks.filter(x=>x.ok).length,total:checks.length};});
const report = { version: JSON.parse((await import('node:fs')).readFileSync('package.json','utf8')).version, syntheticOnly: true, heldOutFromRuleTuning: holdout, explanation: `${holdout ? '보완 후 별도로 만든 합성 서식, 결과로 규칙을 추가 조정하지 않음.' : '최초 합성 3종 결과를 보완에 사용한 회귀 검증.'} 수료·비수료 문서를 함께 평가. 실제 새 발급기관 독립 표본이나 사람 사용성 실험이 아님. OCR 실행은 현재 호스트에서만 검증. 기본/사용자 확정 매핑 미사용. 생산 processPage/refreshFlags 사용.`, engine: ocr.name, fallbackReason: ocr.fallbackReason, fields, documents: results.length, wrongWithoutWarning: results.filter(r=>r.silentError).length, results };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({...report,results:undefined},null,2));
await ocr.close(); await db.destroy();
if (report.wrongWithoutWarning) process.exitCode = 2;
