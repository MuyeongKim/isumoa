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
  /** 검수 대기 이수증 (서무는 자기가 올렸거나 담당 부서 직원의 것) */
  drafts: number;
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

// ── 이수증 올리기·검수 ──────────────────────────────────────────

export const CERTIFICATE_STATUSES = ['draft', 'confirmed', 'excluded'] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
export const CERTIFICATE_STATUS_LABELS: Record<CertificateStatus, string> = {
  draft: '검수 대기',
  confirmed: '확정',
  excluded: '제외',
};

/** error: 고치기 전에는 확정할 수 없음, warning: 확인 권장, info: 참고 */
export type FlagLevel = 'error' | 'warning' | 'info';

export interface CertificateFlag {
  code: string;
  level: FlagLevel;
  message: string;
}

export interface BatchSummary {
  id: number;
  year: number;
  title: string | null;
  createdBy: string;
  createdAt: string;
  files: number;
  /** 파일들의 전체 쪽 수 */
  pagesExpected: number;
  /** 올라온 쪽 수 (중간에 끊기면 pagesExpected보다 적다) */
  pages: number;
  pagesWaiting: number;
  pagesError: number;
  drafts: number;
  confirmed: number;
  excluded: number;
}

export interface FileUploadResult {
  fileId: number | null;
  /** 전에 다른 묶음으로 올린 똑같은 파일 */
  duplicateOf: { batchId: number; fileName: string; createdAt: string } | null;
  /** 이미 올라간 쪽 번호 (이어 올리기) */
  uploadedPages: number[];
}

export interface ProcessingStatus {
  waiting: number;
  running: number;
  failed: number;
  /** 남은 쪽을 처리하는 데 걸릴 것으로 보이는 시간(초) */
  etaSeconds: number | null;
}

export interface EmployeeRef {
  id: number;
  name: string;
  empNo: string | null;
  departmentName: string | null;
  birthDate: string | null;
}

export interface EmployeeCandidate extends EmployeeRef {
  reason: string;
}

export interface CertificateListItem {
  id: number;
  batchId: number;
  pageId: number;
  fileName: string;
  pageNo: number;
  pageCount: number;
  status: CertificateStatus;
  personName: string | null;
  employee: EmployeeRef | null;
  trainingIds: number[];
  completedOn: string | null;
  hours: number | null;
  flags: CertificateFlag[];
  route: string | null;
}

export interface CertificateCredit {
  trainingId: number;
  creditedHours: number | null;
}

export interface CertificateDetail extends CertificateListItem {
  personBirth: string | null;
  personDept: string | null;
  courseTitle: string | null;
  provider: string | null;
  certNo: string | null;
  hoursText: string | null;
  year: number | null;
  batchYear: number;
  credits: CertificateCredit[];
  candidates: EmployeeCandidate[];
  pageText: string;
  excludeReason: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

/** 검수 화면에서 저장·확정할 때 보내는 값 */
export interface CertificateInput {
  employeeId: number | null;
  credits: CertificateCredit[];
  completedOn: string | null;
  hours: number | null;
  courseTitle: string | null;
  provider: string | null;
  certNo: string | null;
  year: number | null;
}

// ── 이수 판정 ───────────────────────────────────────────────────

export type CompletionState = 'done' | 'partial' | 'none' | 'exempt';
export const COMPLETION_LABELS: Record<CompletionState, string> = {
  done: '이수',
  partial: '부분이수',
  none: '미이수',
  exempt: '대상 제외',
};

export interface StatusCell {
  state: CompletionState;
  /** 인정 시간 합계 */
  hours: number;
  count: number;
  certificateIds: number[];
  note: string | null;
}

export interface StatusRow {
  employeeId: number;
  empNo: string | null;
  name: string;
  departmentName: string | null;
  cells: Record<number, StatusCell>;
}

export interface StatusTrainingSummary {
  trainingId: number;
  target: number;
  done: number;
  partial: number;
  none: number;
  exempt: number;
  /** 이수율 0~1 (대상이 없으면 null) */
  rate: number | null;
}

export interface StatusReport {
  year: number;
  trainings: Training[];
  rows: StatusRow[];
  summary: StatusTrainingSummary[];
}
