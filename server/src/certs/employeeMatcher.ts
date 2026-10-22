import type { EmployeeCandidate, EmployeeStatus } from '../../../shared/types.ts';
import { nameKey } from '../lib/text.ts';

// 이수증에 적힌 이름을 직원 명단에서 찾는다. AI에는 명단을 보내지 않고 여기서만 맞춘다.
// OCR이 '오호영'을 '오후영'으로 읽는 일이 있어, 자모 하나 차이까지는 "비슷한 이름" 후보로 본다.

export interface MatchableEmployee {
  id: number;
  name: string;
  nameKey: string;
  empNo: string | null;
  departmentId: number | null;
  departmentName: string | null;
  birthDate: string | null;
  status: EmployeeStatus;
}

export interface MatchInput {
  name: string | null;
  birth: string | null;
  /** 이수증에 적힌 소속 (예: "가람시 총무과") */
  dept: string | null;
  /** 이수증 글 전체. 이름 항목을 못 읽었을 때 글 속에서 명단의 이름을 찾는 데 쓴다 */
  text?: string;
}

export interface MatchResult {
  employeeId: number | null;
  /** exact: 이름이 같음, similar: 자모 하나 차이, text: 이름 항목 없이 글 속에서 찾음 */
  method: 'exact' | 'similar' | 'text' | null;
  candidates: EmployeeCandidate[];
}

/** 한글 음절을 초성·중성·종성 자모로 풀어 쓴다 ("호" → "ㅎㅗ") */
export function toJamo(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) {
      out += ch;
      continue;
    }
    out += String.fromCharCode(0x1100 + Math.floor(code / 588), 0x1161 + Math.floor((code % 588) / 28));
    if (code % 28) out += String.fromCharCode(0x11a7 + (code % 28));
  }
  return out;
}

export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

export function nameDistance(a: string, b: string): number {
  return editDistance(toJamo(nameKey(a)), toJamo(nameKey(b)));
}

function compact(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '');
}

function candidate(e: MatchableEmployee, reason: string): EmployeeCandidate {
  return { id: e.id, name: e.name, empNo: e.empNo, departmentName: e.departmentName, birthDate: e.birthDate, reason };
}

/**
 * OCR이 "성명" 항목 이름을 빠뜨려도 이름 자체는 제대로 읽는 경우가 많아서,
 * 글 속에 명단의 이름이 그대로 있는지 찾는다. 세 글자 이상은 붙여 쓴 글에서, 두 글자는 따로 떨어진 낱말일 때만.
 */
function namesInText(text: string, employees: MatchableEmployee[]): MatchableEmployee[] {
  const normalized = text.normalize('NFC');
  const compactText = normalized.replace(/\s+/g, '');
  const words = new Set(normalized.split(/[^가-힣]+/));
  return employees.filter((e) => (e.nameKey.length >= 3 ? compactText.includes(e.nameKey) : words.has(e.nameKey)));
}

export function matchEmployee(input: MatchInput, employees: MatchableEmployee[], scope: number[] | null): MatchResult {
  const key = input.name ? nameKey(input.name) : '';
  let method: MatchResult['method'] = null;
  let pool: MatchableEmployee[] = [];
  if (key) {
    const exact = employees.filter((e) => e.nameKey === key);
    method = exact.length > 0 ? 'exact' : 'similar';
    pool = exact.length > 0 ? exact : employees.filter((e) => key.length >= 2 && nameDistance(e.name, key) <= 1);
  }
  if (pool.length === 0 && input.text) {
    method = 'text';
    pool = namesInText(input.text, employees);
  }
  if (pool.length === 0) return { employeeId: null, method: null, candidates: [] };

  // 퇴직자는 다른 사람이 없을 때만
  const working = pool.filter((e) => e.status !== 'retired');
  if (working.length > 0) pool = working;

  const reasonOf = (e: MatchableEmployee) =>
    method === 'exact' ? '이름 같음' : method === 'text' ? '이수증 글 속에 있는 이름' : `비슷한 이름 (${input.name} → ${e.name})`;
  const all = pool.map((e) => candidate(e, reasonOf(e)));
  const pick = (e: MatchableEmployee, extra: string): MatchResult => ({
    employeeId: e.id,
    method,
    candidates: all.map((c) => (c.id === e.id ? { ...c, reason: `${c.reason}, ${extra}` } : c)),
  });

  if (input.birth) {
    const sameBirth = pool.filter((e) => e.birthDate === input.birth);
    if (sameBirth.length === 1) return pick(sameBirth[0], '생년월일 같음');
    if (sameBirth.length > 1) pool = sameBirth;
    // 생년월일이 적혀 있는데 모두 다르면 다른 사람일 수 있으니 자동으로 고르지 않는다
    else if (pool.every((e) => e.birthDate)) return { employeeId: null, method, candidates: all.map((c) => ({ ...c, reason: `${c.reason}, 생년월일 다름` })) };
  }
  if (input.dept) {
    const dept = compact(input.dept);
    const sameDept = pool.filter((e) => e.departmentName && dept.includes(compact(e.departmentName)));
    if (sameDept.length === 1) return pick(sameDept[0], '소속 같음');
    if (sameDept.length > 1) pool = sameDept;
  }
  if (scope) {
    const inScope = pool.filter((e) => e.departmentId !== null && scope.includes(e.departmentId));
    if (inScope.length === 1) return pick(inScope[0], '담당 부서 직원');
  }
  if (pool.length === 1) return pick(pool[0], '유일한 후보');
  return { employeeId: null, method, candidates: all };
}
