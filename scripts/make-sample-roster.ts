// 시연·테스트용 가상 인사 명단을 만든다 (실존 인물·기관 아님).
// 실행: npm run samples  →  samples/ 폴더에 xlsx·xls·CP949 CSV와 "변경분" 파일이 생긴다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import { makePeople, ORG, ymd, type Person } from './fixtures/people.ts';

const OUT_DIR = fileURLToPath(new URL('../samples/', import.meta.url));
const HEADER = ['연번', '사번', '성명', '소속', '직급', '직종', '생년월일', '재직상태', '임용일'];

function sheetRows(people: Person[], datesAsText: boolean): unknown[][] {
  return people.map((p, i) => [
    i + 1,
    p.empNo,
    p.name,
    p.department,
    p.grade,
    p.type,
    datesAsText ? ymd(p.birth) : p.birth,
    p.status,
    datesAsText ? ymd(p.hired) : p.hired,
  ]);
}

function writeWorkbook(file: string, rows: unknown[][], bookType: 'xlsx' | 'xls') {
  // 실제 인사 명단처럼 위에 제목 줄과 빈 줄을 둔다
  const sheet = XLSX.utils.aoa_to_sheet(
    [[`${new Date().getFullYear()}년 ${ORG} 직원 현황`], ['(기준일: 10월 1일)'], [], HEADER, ...rows],
    { cellDates: true, dateNF: 'yyyy-mm-dd' },
  );
  sheet['!cols'] = [6, 10, 10, 14, 10, 8, 12, 8, 12].map((wch) => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '직원명단');
  writeFileSync(join(OUT_DIR, file), XLSX.write(book, { type: 'buffer', bookType }));
}

mkdirSync(OUT_DIR, { recursive: true });
const people = makePeople(120);

writeWorkbook('직원명단_2026.xlsx', sheetRows(people, false), 'xlsx');
writeWorkbook('직원명단_2026.xls', sheetRows(people, false), 'xls');

// 한글 윈도우 엑셀에서 "CSV로 저장"한 것과 같은 CP949 파일, 생년월일은 6자리
const csvLines = [
  ['사번', '성명', '부서', '직급', '생년월일'].join(','),
  ...people.map((p) => [p.empNo, p.name, p.department, p.grade, ymd(p.birth).slice(2).replaceAll('-', '')].join(',')),
];
writeFileSync(join(OUT_DIR, '직원명단_2026_cp949.csv'), iconv.encode(csvLines.join('\r\n') + '\r\n', 'cp949'));

// 몇 달 뒤 명단: 전보 3명, 승진 1명, 신규 2명, 퇴직(명단에서 빠짐) 1명, 생년월일 대신 주민번호 앞자리
const later = people.map((p) => ({ ...p }));
later[2].department = '총무과';
later[5].department = '재무과';
later[9].department = '정보통신과';
later[4].grade = '행정6급';
later.splice(40, 1);
later.push(...makeNewHires());
const laterRows = later.map((p, i) => [
  i + 1,
  p.empNo,
  p.name,
  p.department,
  p.grade,
  p.type,
  `${ymd(p.birth).slice(2).replaceAll('-', '')}-${p.birth.getFullYear() < 2000 ? 1 : 3}******`,
  p.status,
  p.hired,
]);
const laterSheet = XLSX.utils.aoa_to_sheet(
  [['직원 현황 (변경분 반영)'], [], [...HEADER.slice(0, 6), '주민등록번호', ...HEADER.slice(7)], ...laterRows],
  { cellDates: true },
);
const laterBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(laterBook, laterSheet, '직원명단');
writeFileSync(join(OUT_DIR, '직원명단_변경분.xlsx'), XLSX.write(laterBook, { type: 'buffer', bookType: 'xlsx' }));

function makeNewHires(): Person[] {
  return [
    { empNo: '2026901', name: '윤하람', department: '환경과', grade: '행정9급', type: '일반직', birth: new Date(2000, 4, 2), status: '재직', hired: new Date(2026, 6, 1) },
    { empNo: '2026902', name: '서도윤', department: '복지정책과', grade: '행정9급', type: '일반직', birth: new Date(1999, 10, 21), status: '재직', hired: new Date(2026, 6, 1) },
  ];
}

console.log(`가상 명단을 만들었습니다 → ${OUT_DIR}`);
console.log('  직원명단_2026.xlsx / .xls  (제목 줄 포함, 120명)');
console.log('  직원명단_2026_cp949.csv     (한글 윈도우 CSV, 생년월일 6자리)');
console.log('  직원명단_변경분.xlsx         (전보 3, 승진 1, 신규 2, 퇴직 1, 주민번호 열)');
