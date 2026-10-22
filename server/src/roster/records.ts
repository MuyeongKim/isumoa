import type { EmployeeStatus, RosterMapping } from '../../../shared/types.ts';
import { parseDateLoose } from '../lib/dates.ts';
import { cleanOrNull, cleanText, nameKey } from '../lib/text.ts';

/** 명단 파일의 한 줄을 정리한 결과 */
export interface RosterRecord {
  /** 엑셀에서 보이는 행 번호 (1부터) */
  rowNumber: number;
  empNo: string | null;
  name: string;
  nameKey: string;
  departmentName: string;
  position: string | null;
  empType: string | null;
  birthDate: string | null;
  status: EmployeeStatus | null;
  hiredOn: string | null;
  leftOn: string | null;
  fromResidentNumber: boolean;
  errors: string[];
  warnings: string[];
}

// 포함된 단어로 재직 상태를 판단한다. '전출파견'이 퇴직으로 잡히지 않도록 파견을 먼저 본다.
const STATUS_WORDS: [EmployeeStatus, string[]][] = [
  ['dispatched', ['파견']],
  ['leave', ['휴직', '병가']],
  ['retired', ['퇴직', '퇴사', '면직', '사직', '전출', '정년']],
  ['active', ['재직', '근무', '정상', '현원']],
];

export function parseStatus(text: string): EmployeeStatus | null {
  const compact = text.replace(/\s+/g, '');
  if (compact === '') return null;
  for (const [status, words] of STATUS_WORDS) {
    if (words.some((w) => compact.includes(w))) return status;
  }
  return null;
}

function cell(row: string[], index: number | null): string {
  return index === null ? '' : cleanText(row[index]);
}

const TOTAL_ROW = /^(합계|총계|소계|계)$/;

export function toRecords(rows: string[][], headerRowIndex: number, mapping: RosterMapping): RosterRecord[] {
  const records: RosterRecord[] = [];
  const mappedColumns = Object.values(mapping).filter((v): v is number => v !== null);

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (mappedColumns.every((c) => cleanText(row[c]) === '')) continue;

    const name = cell(row, mapping.name);
    if (TOTAL_ROW.test(name.replace(/\s+/g, ''))) continue;

    const errors: string[] = [];
    const warnings: string[] = [];
    const departmentName = cell(row, mapping.department);
    if (name === '') errors.push('성명이 비어 있습니다.');
    if (departmentName === '') errors.push('부서가 비어 있습니다.');

    const dateField = (index: number | null, label: string) => {
      const raw = cell(row, index);
      const parsed = parseDateLoose(raw);
      if (raw !== '' && parsed.value === null) warnings.push(`${label} "${raw}"을(를) 날짜로 읽지 못해 비워 둡니다.`);
      return parsed;
    };
    const birth = dateField(mapping.birthDate, '생년월일');
    const hired = dateField(mapping.hiredOn, '임용일');
    const left = dateField(mapping.leftOn, '퇴직일');

    const statusText = cell(row, mapping.status);
    const status = parseStatus(statusText);
    if (statusText !== '' && status === null) warnings.push(`재직 상태 "${statusText}"을(를) 알 수 없어 바꾸지 않습니다.`);

    records.push({
      rowNumber: i + 1,
      empNo: cleanOrNull(cell(row, mapping.empNo)),
      name,
      nameKey: nameKey(name),
      departmentName,
      position: cleanOrNull(cell(row, mapping.position)),
      empType: cleanOrNull(cell(row, mapping.empType)),
      birthDate: birth.value,
      status,
      hiredOn: hired.value,
      leftOn: left.value,
      fromResidentNumber: birth.fromResidentNumber,
      errors,
      warnings,
    });
  }
  return records;
}
