import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { autoMapColumns, detectHeaderRow, emptyMapping } from '../../shared/rosterColumns.ts';
import type { RosterMapping } from '../../shared/types.ts';
import { buildRosterPreview, type ExistingEmployee } from '../../server/src/roster/preview.ts';
import { decodeText, readRosterFile } from '../../server/src/roster/readRosterFile.ts';
import { parseStatus, toRecords } from '../../server/src/roster/records.ts';

function workbookBuffer(rows: unknown[][], bookType: 'xlsx' | 'xls'): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), '명단');
  return XLSX.write(book, { type: 'buffer', bookType });
}

describe('명단 파일 읽기', () => {
  it('CP949 CSV의 확장 한글(똠, 햏)을 깨뜨리지 않는다', () => {
    const buf = iconv.encode('성명,부서\n박똠이,햏정지원과\n', 'cp949');
    expect(decodeText(buf)).toContain('박똠이,햏정지원과');
    expect(readRosterFile(buf)[0].rows[1]).toEqual(['박똠이', '햏정지원과']);
  });

  it('BOM이 있는 UTF-8 CSV를 읽는다', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('성명,부서\n홍길동,총무과\n')]);
    expect(readRosterFile(buf)[0].rows).toEqual([
      ['성명', '부서'],
      ['홍길동', '총무과'],
    ]);
  });

  it.each(['xlsx', 'xls'] as const)('%s의 날짜 칸과 빈 줄을 엑셀 행 번호 그대로 읽는다', (bookType) => {
    const buf = workbookBuffer([['2026년 직원 현황'], [], ['성명', '생년월일'], ['홍길동', new Date(1985, 2, 12)]], bookType);
    const rows = readRosterFile(buf)[0].rows;
    expect(rows[2]).toEqual(['성명', '생년월일']);
    expect(rows[3]).toEqual(['홍길동', '1985-03-12']);
  });
});

describe('머리글 찾기와 열 연결', () => {
  it('제목 줄 아래의 머리글 줄을 찾는다', () => {
    const rows = [['2026년 직원 현황'], ['(기준일: 10월 1일)'], [], ['연번', '사번', '성명', '소속', '직급']];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it('흔한 머리글 이름으로 열을 연결한다', () => {
    const mapping = autoMapColumns(['연번', '직원번호', '성 명', '소속부서명', '직위', '주민등록번호', '재직구분', '최초임용일']);
    expect(mapping).toMatchObject({
      empNo: 1,
      name: 2,
      department: 3,
      position: 4,
      birthDate: 5,
      status: 6,
      hiredOn: 7,
      empType: null,
      leftOn: null,
    });
  });
});

describe('행 정리', () => {
  it('재직 상태 단어를 읽는다', () => {
    expect(parseStatus('재직')).toBe('active');
    expect(parseStatus('육아휴직')).toBe('leave');
    expect(parseStatus('전출파견')).toBe('dispatched');
    expect(parseStatus('의원면직')).toBe('retired');
    expect(parseStatus('알수없음')).toBeNull();
  });

  it('필수 칸이 빈 행은 오류, 읽지 못한 날짜는 경고로 남긴다', () => {
    const mapping: RosterMapping = { ...emptyMapping(), name: 0, department: 1, birthDate: 2 };
    const records = toRecords(
      [
        ['성명', '부서', '생년월일'],
        ['홍길동', '총무과', '850312-1******'],
        ['', '재무과', ''],
        ['이몽룡', '재무과', '모름'],
        ['합계', '', ''],
      ],
      0,
      mapping,
    );
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ name: '홍길동', birthDate: '1985-03-12', fromResidentNumber: true, errors: [] });
    expect(records[1].errors).toContain('성명이 비어 있습니다.');
    expect(records[2].birthDate).toBeNull();
    expect(records[2].warnings[0]).toContain('모름');
  });
});

describe('명단 비교 미리보기', () => {
  const mapping: RosterMapping = { ...emptyMapping(), empNo: 0, name: 1, department: 2, position: 3, birthDate: 4 };
  const existing: ExistingEmployee[] = [
    { id: 1, empNo: '1001', name: '홍길동', nameKey: '홍길동', departmentName: '총무과', position: '7급', empType: null, birthDate: '1985-03-12', status: 'active', hiredOn: null, leftOn: null },
    { id: 2, empNo: '1002', name: '이몽룡', nameKey: '이몽룡', departmentName: '재무과', position: '8급', empType: null, birthDate: null, status: 'active', hiredOn: null, leftOn: null },
    { id: 3, empNo: '1003', name: '성춘향', nameKey: '성춘향', departmentName: '재무과', position: '9급', empType: null, birthDate: null, status: 'active', hiredOn: null, leftOn: null },
  ];

  function preview(rows: string[][], retireMissing = false) {
    const records = toRecords([['사번', '성명', '부서', '직급', '생년월일'], ...rows], 0, mapping);
    return buildRosterPreview(records, existing, ['총무과', '재무과'], mapping, retireMissing);
  }

  it('신규·변경·그대로·누락을 나누고 새 부서를 찾는다', () => {
    const { preview: p, plan } = preview(
      [
        ['1001', '홍길동', '총무과', '7급', '1985-03-12'],
        ['1002', '이몽룡', '기획예산과', '7급', ''],
        ['2001', '변학도', '기획예산과', '5급', ''],
      ],
      true,
    );
    expect(p.counts).toEqual({ new: 1, changed: 1, unchanged: 1, error: 0, missing: 1 });
    expect(p.newDepartments).toEqual(['기획예산과']);
    const changed = p.rows.find((r) => r.kind === 'changed')!;
    expect(changed.changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['부서', '재무과', '기획예산과'],
      ['직급·직위', '8급', '7급'],
    ]);
    expect(plan.retireIds).toEqual([3]);
  });

  it('빈 칸은 기존 값을 지우지 않는다', () => {
    const { preview: p } = preview([['1001', '홍길동', '총무과', '', '']]);
    expect(p.counts.unchanged).toBe(1);
  });

  it('파일 안의 사번 중복은 오류로 뺀다', () => {
    const { preview: p, plan } = preview([
      ['3001', '김가온', '총무과', '', ''],
      ['3001', '김나온', '총무과', '', ''],
    ]);
    expect(p.counts.error).toBe(1);
    expect(p.rows[1].errors[0]).toContain('2행과 중복');
    expect(plan.creates).toHaveLength(1);
  });

  it('사번이 없으면 이름과 생년월일로 찾고, 구분할 수 없는 동명이인은 오류로 둔다', () => {
    const noEmpNo: RosterMapping = { ...mapping, empNo: null };
    const twins: ExistingEmployee[] = [
      ...existing,
      { ...existing[0], id: 4, empNo: '1004', departmentName: '재무과', birthDate: '1990-01-01' },
    ];
    const records = toRecords(
      [
        ['사번', '성명', '부서', '직급', '생년월일'],
        ['', '홍길동', '재무과', '6급', '1990-01-01'],
        ['', '홍길동', '민원과', '6급', ''],
      ],
      0,
      noEmpNo,
    );
    const { preview: p } = buildRosterPreview(records, twins, ['총무과', '재무과'], noEmpNo, false);
    expect(p.rows[0]).toMatchObject({ kind: 'changed', employeeId: 4 });
    expect(p.rows[1].kind).toBe('error');
    expect(p.notices[0]).toContain('사번 열이 없어');
  });
});
