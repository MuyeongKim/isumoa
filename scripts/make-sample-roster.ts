// 시연·테스트용 가상 인사 명단을 만든다 (실존 인물·기관 아님).
// 실행: npm run samples  →  samples/ 폴더에 xlsx·xls·CP949 CSV와 "변경분" 파일이 생긴다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';

const OUT_DIR = fileURLToPath(new URL('../samples/', import.meta.url));
const ORG = '가람시';

/** 실행할 때마다 같은 명단이 나오도록 고정된 난수 */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seededRandom(20261022);
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const SYLLABLES = ['민', '서', '지', '현', '우', '준', '수', '영', '은', '혜', '진', '호', '성', '태', '윤', '하', '도', '연', '경', '재', '희', '주', '원', '가', '온', '람', '빈', '솔', '아', '결'];
const DEPARTMENTS = ['기획예산과', '총무과', '재무과', '민원봉사과', '복지정책과', '환경과', '도시계획과', '정보통신과'];
const GRADES = ['행정5급', '행정6급', '행정6급', '행정7급', '행정7급', '행정8급', '행정9급', '전산7급', '시설8급'];

interface Person {
  empNo: string;
  name: string;
  department: string;
  grade: string;
  type: string;
  birth: Date;
  status: string;
  hired: Date;
}

function makePeople(count: number): Person[] {
  const used = new Set<string>();
  const people: Person[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    do name = pick(SURNAMES) + pick(SYLLABLES) + pick(SYLLABLES);
    while (used.has(name));
    used.add(name);
    const hiredYear = 1995 + Math.floor(random() * 30);
    const type = random() < 0.12 ? '공무직' : random() < 0.05 ? '기간제' : '일반직';
    people.push({
      empNo: `${hiredYear}${String(i + 1).padStart(3, '0')}`,
      name,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      grade: type === '일반직' ? pick(GRADES) : type,
      type,
      birth: new Date(1966 + Math.floor(random() * 35), Math.floor(random() * 12), 1 + Math.floor(random() * 28)),
      status: '재직',
      hired: new Date(hiredYear, Math.floor(random() * 12), 1 + Math.floor(random() * 28)),
    });
  }
  // 시연용 사례: 동명이인(부서·생년월일이 다름), 휴직, 파견, CP949 확장 한글 이름
  people[7] = { ...people[7], name: '김민준' };
  people[20] = { ...people[20], name: '김민준' };
  people[11].status = '휴직';
  people[15].status = '파견';
  people[33].name = '박똠이';
  return people;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
