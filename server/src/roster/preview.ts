import {
  EMPLOYEE_STATUS_LABELS,
  ROSTER_FIELDS,
  type EmployeeStatus,
  type RosterChange,
  type RosterFieldKey,
  type RosterMapping,
  type RosterPreview,
  type RosterPreviewRow,
} from '../../../shared/types.ts';
import type { RosterRecord } from './records.ts';

// 명단 파일과 지금 등록된 직원을 비교해 신규·변경·동일·오류·누락을 나눈다.
// DB를 건드리지 않는 순수 함수라서 테스트하기 쉽다. 실제 반영은 routes/employees.ts가 한다.

export interface ExistingEmployee {
  id: number;
  empNo: string | null;
  name: string;
  nameKey: string;
  departmentName: string | null;
  position: string | null;
  empType: string | null;
  birthDate: string | null;
  status: EmployeeStatus;
  hiredOn: string | null;
  leftOn: string | null;
}

export interface RosterUpdate {
  employeeId: number;
  record: RosterRecord;
  changes: RosterChange[];
}

export interface RosterPlan {
  creates: RosterRecord[];
  updates: RosterUpdate[];
  unchanged: number;
  retireIds: number[];
  newDepartments: string[];
  skipped: number;
}

const LABELS = Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, f.label])) as Record<RosterFieldKey, string>;

/** 비교할 항목: [명단 항목, 기존 직원 값, 명단 값] */
function comparableFields(record: RosterRecord, existing: ExistingEmployee): [RosterFieldKey, string | null, string | null][] {
  return [
    ['empNo', existing.empNo, record.empNo],
    ['name', existing.name, record.name],
    ['department', existing.departmentName, record.departmentName],
    ['position', existing.position, record.position],
    ['empType', existing.empType, record.empType],
    ['birthDate', existing.birthDate, record.birthDate],
    ['status', existing.status, record.status],
    ['hiredOn', existing.hiredOn, record.hiredOn],
    ['leftOn', existing.leftOn, record.leftOn],
  ];
}

function display(field: RosterFieldKey, value: string | null): string | null {
  if (value !== null && field === 'status') return EMPLOYEE_STATUS_LABELS[value as EmployeeStatus];
  return value;
}

/**
 * 바뀐 항목 목록. 명단에서 연결하지 않은 열이나 빈 칸은 기존 값을 그대로 둔다
 * (빈 칸으로 기존 정보를 지우지 않는다).
 */
function diffRecord(record: RosterRecord, existing: ExistingEmployee, mapping: RosterMapping): RosterChange[] {
  return comparableFields(record, existing)
    .filter(([field, before, after]) => mapping[field] !== null && after !== null && after !== before)
    .map(([field, before, after]) => ({
      field,
      label: LABELS[field],
      before: display(field, before),
      after: display(field, after),
    }));
}

export function buildRosterPreview(
  records: RosterRecord[],
  existing: ExistingEmployee[],
  departmentNames: string[],
  mapping: RosterMapping,
  retireMissing: boolean,
): { preview: RosterPreview; plan: RosterPlan } {
  const byEmpNo = new Map(existing.filter((e) => e.empNo).map((e) => [e.empNo!, e]));
  const byNameKey = new Map<string, ExistingEmployee[]>();
  for (const e of existing) byNameKey.set(e.nameKey, [...(byNameKey.get(e.nameKey) ?? []), e]);

  const rows: RosterPreviewRow[] = [];
  const plan: RosterPlan = { creates: [], updates: [], unchanged: 0, retireIds: [], newDepartments: [], skipped: 0 };
  const firstRowOfEmpNo = new Map<string, number>();
  const matchedBy = new Map<number, number>(); // 직원 id → 그 직원으로 판단한 행 번호

  /** 사번이 없거나 사번으로 못 찾은 경우 이름으로 찾는다 */
  function findByName(record: RosterRecord): { match: ExistingEmployee | null; error?: string; warning?: string } {
    const sameName = (byNameKey.get(record.nameKey) ?? []).filter((e) => !(record.empNo && e.empNo));
    if (sameName.length === 0) return { match: null };
    if (record.birthDate) {
      const sameBirth = sameName.filter((e) => e.birthDate === record.birthDate);
      if (sameBirth.length === 1) return { match: sameBirth[0] };
      if (sameBirth.length > 1) return { match: null, error: '이름과 생년월일이 같은 직원이 여럿이라 구분할 수 없습니다. 사번 열을 지정해 주세요.' };
      if (sameName.every((e) => e.birthDate)) return { match: null }; // 생년월일이 다르면 다른 사람
    }
    const sameDept = sameName.filter((e) => e.departmentName === record.departmentName);
    if (sameDept.length === 1) return { match: sameDept[0] };
    if (sameName.length === 1) {
      return { match: sameName[0], warning: '이름으로만 기존 직원을 찾았습니다. 동명이인이라면 사번이나 생년월일 열을 지정해 주세요.' };
    }
    return { match: null, error: '같은 이름의 직원이 여럿이라 구분할 수 없습니다. 사번 또는 생년월일 열을 지정해 주세요.' };
  }

  for (const record of records) {
    const errors = [...record.errors];
    const warnings = [...record.warnings];
    let match: ExistingEmployee | null = null;

    if (errors.length === 0 && record.empNo) {
      const first = firstRowOfEmpNo.get(record.empNo);
      if (first !== undefined) errors.push(`사번이 ${first}행과 중복됩니다.`);
      else firstRowOfEmpNo.set(record.empNo, record.rowNumber);
    }
    if (errors.length === 0) {
      match = record.empNo ? (byEmpNo.get(record.empNo) ?? null) : null;
      if (!match) {
        const found = findByName(record);
        if (found.error) errors.push(found.error);
        if (found.warning) warnings.push(found.warning);
        match = found.match;
      }
    }
    if (errors.length === 0 && match) {
      const earlier = matchedBy.get(match.id);
      if (earlier !== undefined) errors.push(`${earlier}행과 같은 직원으로 판단됩니다. 중복된 행인지 확인해 주세요.`);
      else matchedBy.set(match.id, record.rowNumber);
    }

    const base = {
      rowNumber: record.rowNumber,
      empNo: record.empNo,
      name: record.name,
      departmentName: record.departmentName,
      errors,
      warnings,
    };
    if (errors.length > 0) {
      rows.push({ ...base, kind: 'error', employeeId: match?.id ?? null, changes: [] });
      plan.skipped++;
      continue;
    }
    if (!departmentNames.includes(record.departmentName) && !plan.newDepartments.includes(record.departmentName)) {
      plan.newDepartments.push(record.departmentName);
    }
    if (!match) {
      rows.push({ ...base, kind: 'new', employeeId: null, changes: [] });
      plan.creates.push(record);
      continue;
    }
    const changes = diffRecord(record, match, mapping);
    if (changes.length === 0) {
      rows.push({ ...base, kind: 'unchanged', employeeId: match.id, changes });
      plan.unchanged++;
    } else {
      rows.push({ ...base, kind: 'changed', employeeId: match.id, changes });
      plan.updates.push({ employeeId: match.id, record, changes });
    }
  }

  const missing = existing.filter((e) => e.status !== 'retired' && !matchedBy.has(e.id));
  if (retireMissing) plan.retireIds = missing.map((e) => e.id);

  const notices: string[] = [];
  if (mapping.empNo === null) notices.push('사번 열이 없어 이름과 생년월일(없으면 부서)로 기존 직원을 찾습니다.');
  if (records.some((r) => r.fromResidentNumber)) {
    notices.push('주민등록번호 형식의 열에서 생년월일만 저장하고, 나머지 번호는 저장하지 않습니다.');
  }

  const count = (kind: RosterPreviewRow['kind']) => rows.filter((r) => r.kind === kind).length;
  return {
    preview: {
      counts: {
        new: count('new'),
        changed: count('changed'),
        unchanged: count('unchanged'),
        error: count('error'),
        missing: missing.length,
      },
      rows,
      missing: missing.map((e) => ({ id: e.id, empNo: e.empNo, name: e.name, departmentName: e.departmentName })),
      newDepartments: plan.newDepartments,
      notices,
    },
    plan,
  };
}
