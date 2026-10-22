// 시연·테스트용 가상 이수증을 만든다 (실존 인물·기관 아님).
// 실행: npm run samples:certs  →  samples/certs/
//   개별/              총무과 직원들이 낸 이수증 PDF(글자 정보 있음) + 사진 1장, 일부러 넣은 문제 사례 포함
//   스캔묶음_재무과.pdf  재무과 이수증을 한꺼번에 스캔한 40쪽 (글자 정보 없음 → OCR 필요)
//   정답.json          파일·쪽별 정답 (인식 정확도 점검용)

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawCertificate, drawMemo, PROVIDERS, type CertData, type Op, type Template } from './fixtures/certificate.ts';
import { makePeople, ymd, type Person } from './fixtures/people.ts';
import { jpegsToPdf, renderScanJpeg, renderTextPdf } from './fixtures/render.ts';

const OUT = fileURLToPath(new URL('../samples/certs/', import.meta.url));
const SINGLE = join(OUT, '개별');

interface Truth {
  file: string;
  page: number;
  kind: 'certificate' | 'memo' | 'blank';
  empNo?: string | null;
  name?: string;
  trainings?: string[];
  completedOn?: string;
  hours?: number | null;
  note?: string;
}
const truth: Truth[] = [];

const VIOLENCE = ['sexual-harassment', 'sexual-violence', 'prostitution', 'domestic-violence'];

interface Course {
  title: string;
  template: Template;
  hoursText: string;
  hours: number | null;
  trainings: string[];
}
const COURSES = {
  violence: { title: '2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)', template: 'formal', hoursText: '4시간', hours: 4, trainings: VIOLENCE },
  disability: { title: '2026 장애인식개선 교육', template: 'table', hoursText: '1시간', hours: 1, trainings: ['disability-awareness'] },
  integrity: { title: '2026년 공직자 청렴교육', template: 'brief', hoursText: '2시간', hours: 2, trainings: ['integrity'] },
  integrityPart: { title: '공직자 청렴교육 - 공직윤리와 반부패', template: 'brief', hoursText: '1시간', hours: 1, trainings: ['integrity'] },
  privacy: { title: '개인정보보호 기본교육', template: 'table', hoursText: '2차시', hours: null, trainings: ['privacy'] },
  conflict: { title: '이해충돌방지법의 이해', template: 'brief', hoursText: '1시간', hours: 1, trainings: ['conflict-of-interest'] },
} satisfies Record<string, Course>;

let certSeq = 100;
function certData(person: Pick<Person, 'name' | 'department'> & { birth: Date | null }, course: Course, completedOn: string): CertData {
  certSeq += 7;
  const no = { formal: `2026-${String(certSeq).padStart(5, '0')}`, table: `VC-2026-${String(certSeq * 13).padStart(6, '0')}`, brief: `청렴-26-${String(certSeq).padStart(4, '0')}` };
  return {
    template: course.template,
    name: person.name,
    birth: person.birth ? ymd(person.birth) : null,
    department: person.department,
    courseTitle: course.title,
    periodStart: course.template === 'brief' ? completedOn : `${completedOn.slice(0, 8)}01`,
    completedOn,
    hoursText: course.hoursText,
    certNo: no[course.template],
  };
}

function record(file: string, page: number, person: { empNo: string | null; name: string } | null, course: Course, completedOn: string, note?: string) {
  truth.push({
    file,
    page,
    kind: 'certificate',
    empNo: person?.empNo ?? null,
    name: person?.name,
    trainings: course.trainings,
    completedOn,
    hours: course.hours,
    note,
  });
}

/** 표 양식은 생년월일 칸이 없다 */
function forTemplate(p: Person, course: Course) {
  return { ...p, birth: course.template === 'table' ? null : p.birth };
}

async function single(file: string, pages: { person: Person; course: Course; date: string; note?: string }[]) {
  const ops: Op[][] = pages.map(({ person, course, date }) => drawCertificate(certData(forTemplate(person, course), course, date)));
  writeFileSync(join(SINGLE, file), await renderTextPdf(ops));
  pages.forEach(({ person, course, date, note }, i) => record(`개별/${file}`, i + 1, person, course, date, note));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(SINGLE, { recursive: true });
const people = makePeople(120);
const general = people.filter((p) => p.department === '총무과');
const finance = people.filter((p) => p.department === '재무과');
const day = (month: number, d: number) => `2026-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ── 개별 PDF: 총무과 ────────────────────────────────────────
for (const [i, p] of general.entries()) {
  await single(`이수증_${p.name}_폭력예방.pdf`, [{ person: p, course: COURSES.violence, date: day(3, 10 + i) }]);
  if (i < 10) await single(`${p.name}_장애인식개선.pdf`, [{ person: p, course: COURSES.disability, date: day(4, 6 + i) }]);
}
await single(`${general[0].name}_청렴1차.pdf`, [{ person: general[0], course: COURSES.integrityPart, date: day(5, 20), note: '1시간+1시간 합산' }]);
await single(`${general[0].name}_청렴2차.pdf`, [{ person: general[0], course: COURSES.integrityPart, date: day(8, 12), note: '1시간+1시간 합산' }]);
await single(`${general[1].name}_청렴교육.pdf`, [{ person: general[1], course: COURSES.integrity, date: day(6, 3) }]);
await single(`${general[2].name}_청렴교육.pdf`, [{ person: general[2], course: COURSES.integrity, date: day(6, 4) }]);
await single(`${general[3].name}_개인정보보호.pdf`, [{ person: general[3], course: COURSES.privacy, date: day(7, 1), note: '시간이 차시 단위' }]);
const ddom = general.find((p) => p.name === '박똠이')!;
await single(`${ddom.name}_폭력예방(재발급).pdf`, [
  { person: ddom, course: COURSES.violence, date: day(3, 10 + general.indexOf(ddom)), note: '같은 직원·교육·이수일 중복' },
]);
copyFileSync(join(SINGLE, `이수증_${general[5].name}_폭력예방.pdf`), join(SINGLE, 'scan_0007.pdf'));
truth.push({ file: '개별/scan_0007.pdf', page: 1, kind: 'certificate', note: `이수증_${general[5].name}_폭력예방.pdf와 같은 파일` });
await single(`${general[6].name}_청렴교육_2025.pdf`, [{ person: general[6], course: COURSES.integrity, date: '2025-11-20', note: '작년 이수' }]);
await single(`${general[7].name}_이수증모음.pdf`, [
  { person: general[7], course: COURSES.integrity, date: day(6, 9) },
  { person: general[7], course: COURSES.disability, date: day(9, 1) },
]);
await single(`${general[8].name}_이해충돌방지.pdf`, [{ person: general[8], course: COURSES.conflict, date: day(9, 2), note: '사용 안 하는 교육' }]);
const outsider = { empNo: null, name: '최가상', department: '총무과', birth: new Date(1990, 0, 1) } as unknown as Person;
await single('최가상_장애인식개선.pdf', [{ person: outsider, course: COURSES.disability, date: day(4, 30), note: '명단에 없는 사람' }]);
const twins = people.filter((p) => p.name === '김민준');
await single('김민준_폭력예방.pdf', [{ person: twins[0], course: COURSES.violence, date: day(3, 30), note: '동명이인 — 생년월일로 구분' }]);
await single('김민준_장애인식개선.pdf', [{ person: twins[1], course: COURSES.disability, date: day(4, 28), note: '동명이인 — 소속으로 구분' }]);

// 휴대폰으로 찍은 사진 1장
const photoPerson = general[9];
writeFileSync(
  join(SINGLE, `사진_${photoPerson.name}_청렴.jpg`),
  await renderScanJpeg(drawCertificate(certData(photoPerson, COURSES.integrity, day(6, 5))), { angle: 2, dpi: 180, seed: 77 }),
);
record(`개별/사진_${photoPerson.name}_청렴.jpg`, 1, photoPerson, COURSES.integrity, day(6, 5), '사진 파일');

// ── 스캔 묶음: 재무과 40쪽 ───────────────────────────────────
const scanFile = '스캔묶음_재무과.pdf';
const scanPages: { ops: Op[]; truth: Omit<Truth, 'file' | 'page'> }[] = [
  {
    ops: drawMemo(['재무과 법정교육 이수증 제출', '제출일: 2026. 9. 15.', '제출자: 재무과 서무', '첨부: 이수증 38매']),
    truth: { kind: 'memo' },
  },
];
for (const [i, p] of finance.entries()) {
  const v = day(3, 3 + i);
  const n = day(5, 4 + i);
  scanPages.push(
    { ops: drawCertificate(certData(p, COURSES.violence, v)), truth: { kind: 'certificate', empNo: p.empNo, name: p.name, trainings: VIOLENCE, completedOn: v, hours: 4 } },
    { ops: drawCertificate(certData(p, COURSES.integrity, n)), truth: { kind: 'certificate', empNo: p.empNo, name: p.name, trainings: ['integrity'], completedOn: n, hours: 2 } },
  );
  if (i < 8) {
    const d = day(4, 13 + i);
    scanPages.push({
      ops: drawCertificate(certData({ ...p, birth: null }, COURSES.disability, d)),
      truth: { kind: 'certificate', empNo: p.empNo, name: p.name, trainings: ['disability-awareness'], completedOn: d, hours: 1 },
    });
  }
  if (i === 6) scanPages.push({ ops: [], truth: { kind: 'blank' } });
}
const jpegs: Buffer[] = [];
for (const [i, page] of scanPages.entries()) {
  jpegs.push(await renderScanJpeg(page.ops, { angle: ((i * 37) % 30) / 10 - 1.5, seed: i + 11 }));
  truth.push({ file: scanFile, page: i + 1, ...page.truth });
}
writeFileSync(join(OUT, scanFile), await jpegsToPdf(jpegs));

writeFileSync(join(OUT, '정답.json'), JSON.stringify(truth, null, 2));
console.log(`가상 이수증을 만들었습니다 → ${OUT}`);
console.log(`  개별/  ${truth.filter((t) => t.file.startsWith('개별/')).length}쪽 (문제 사례 포함)`);
console.log(`  ${scanFile}  ${scanPages.length}쪽`);
console.log(`  기관 이름(${Object.values(PROVIDERS).join(', ')})과 사람은 모두 가상입니다.`);
