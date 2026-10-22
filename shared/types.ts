// 화면(web)과 서버(server)가 함께 쓰는 타입과 상수.
// 서버는 Node의 타입 제거 기능으로 실행되므로 enum 대신 `as const` 배열을 쓴다.

export const ROLES = ['admin', 'clerk'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { admin: '관리자', clerk: '서무' };

export const EMPLOYEE_STATUSES = ['active', 'leave', 'dispatched', 'retired'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: '재직',
  leave: '휴직',
  dispatched: '파견',
  retired: '퇴직',
};

// 교육 이수 기준: 연 N회(count) 또는 연 N시간(hours)
export const REQ_TYPES = ['count', 'hours'] as const;
export type ReqType = (typeof REQ_TYPES)[number];

export interface DepartmentRef {
  id: number;
  name: string;
}

export interface Department extends DepartmentRef {
  sortOrder: number;
  active: boolean;
  employeeCount: number;
  clerkCount: number;
}

export interface SessionUser {
  id: number;
  loginId: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  departments: DepartmentRef[];
}

export interface UserAccount {
  id: number;
  loginId: string;
  name: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  locked: boolean;
  lastLoginAt: string | null;
  departments: DepartmentRef[];
}

export interface Employee {
  id: number;
  empNo: string | null;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  position: string | null;
  empType: string | null;
  birthDate: string | null;
  status: EmployeeStatus;
  hiredOn: string | null;
  leftOn: string | null;
  note: string | null;
}

export interface Training {
  id: number;
  code: string;
  name: string;
  category: string | null;
  legalBasis: string | null;
  reqType: ReqType;
  reqValue: number;
  keywords: string[];
  fromYear: number | null;
  toYear: number | null;
  active: boolean;
  sortOrder: number;
  note: string | null;
}

export interface AppMeta {
  orgName: string;
  needsSetup: boolean;
  version: string;
}

export interface Overview {
  departments: number;
  employees: number;
  activeTrainings: number;
  clerks: number;
}

// ── 직원 명단 일괄 등록 ──────────────────────────────────────────

export const ROSTER_FIELDS = [
  { key: 'empNo', label: '사번', required: false },
  { key: 'name', label: '성명', required: true },
  { key: 'department', label: '부서', required: true },
  { key: 'position', label: '직급·직위', required: false },
  { key: 'empType', label: '직종', required: false },
  { key: 'birthDate', label: '생년월일', required: false },
  { key: 'status', label: '재직 상태', required: false },
  { key: 'hiredOn', label: '임용일', required: false },
  { key: 'leftOn', label: '퇴직일', required: false },
] as const;
export type RosterFieldKey = (typeof ROSTER_FIELDS)[number]['key'];

/** 항목별로 몇 번째 열(0부터)을 쓸지. 쓰지 않으면 null */
export type RosterMapping = Record<RosterFieldKey, number | null>;

export interface RosterParseResult {
  importId: string;
  fileName: string;
  sheets: { name: string; rowCount: number }[];
  sheetIndex: number;
  headerRowIndex: number;
  /** 머리글 줄을 고를 수 있도록 시트 앞부분을 그대로 보여준다 */
  topRows: string[][];
  headers: string[];
  mapping: RosterMapping;
}

export interface RosterImportOptions {
  importId: string;
  sheetIndex: number;
  headerRowIndex: number;
  mapping: RosterMapping;
  retireMissing: boolean;
}

export type RosterRowKind = 'new' | 'changed' | 'unchanged' | 'error';

export interface RosterChange {
  field: RosterFieldKey;
  label: string;
  before: string | null;
  after: string | null;
}

export interface RosterPreviewRow {
  rowNumber: number;
  kind: RosterRowKind;
  employeeId: number | null;
  empNo: string | null;
  name: string;
  departmentName: string;
  changes: RosterChange[];
  errors: string[];
  warnings: string[];
}

export interface RosterPreview {
  counts: Record<RosterRowKind | 'missing', number>;
  rows: RosterPreviewRow[];
  missing: { id: number; empNo: string | null; name: string; departmentName: string | null }[];
  newDepartments: string[];
  notices: string[];
}

export interface RosterApplyResult {
  created: number;
  updated: number;
  unchanged: number;
  retired: number;
  skipped: number;
  departmentsCreated: number;
}
