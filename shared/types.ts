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
  memberCount?: number;
  deletedAt?: string | null;
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
  deletedAt?: string | null;
}

export interface RosterTrashResult {
  changed: number;
  employees?: number;
}

/** 문서에서 읽은 교육 초안. 기준을 찾지 못하면 빈칸으로 두고 등록 전에 확인한다. */
export interface TrainingImportDraft {
  name: string;
  category: string | null;
  legalBasis: string | null;
  reqType: ReqType | null;
  reqValue: number | null;
  keywords: string[];
  fromYear: number | null;
  toYear: number | null;
  note: string | null;
  source: string;
  warnings: string[];
  duplicateId?: number;
}

export interface TrainingDocumentPreview {
  fileName: string;
  drafts: TrainingImportDraft[];
  warnings: string[];
  text: string;
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
  deletedAt?: string | null;
}

export interface AppMeta {
  orgName: string;
  needsSetup: boolean;
  version: string;
  /** PC 설치판(이 PC에서 혼자 쓰는 모드)이면 true — 화면에 "프로그램 끄기"가 보인다 */
  desktop: boolean;
  /** 단일 사용자 모드(시범 서버)이면 true — 로그인 없이 첫 관리자로 들어가므로 로그아웃·비밀번호 변경이 없다 */
  singleUser: boolean;
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
  /** 원본에 적힌 과정명. 검수함 검색에도 사용한다. */
  courseTitle: string | null;
  employee: EmployeeRef | null;
  trainingIds: number[];
  completedOn: string | null;
  hours: number | null;
  flags: CertificateFlag[];
  route: string | null;
  /** 원본 쪽을 (다시) 읽는 중 — 끝나면 이 이수증은 새로 읽은 것으로 바뀐다 */
  reading: boolean;
}

export interface CertificateCredit {
  trainingId: number;
  creditedHours: number | null;
}

export interface BulkExcludePreview {
  ids: number[];
  drafts: number;
  confirmed: number;
  token: string;
  items: { id: number; status: CertificateStatus; employeeName: string | null; fileName: string; courseTitle: string | null }[];
}

export interface BulkExcludeResult {
  excluded: number;
  ids: number[];
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
  departmentId: number | null;
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

// ── 대시보드 ────────────────────────────────────────────────────

export interface DashboardDepartment {
  departmentId: number | null;
  name: string;
  employees: number;
  /** 대상 교육을 모두 이수한 직원 (모든 교육이 대상 제외인 직원은 이수·미이수 어디에도 넣지 않음) */
  complete: number;
  /** 미이수·부분이수 교육이 하나라도 있는 직원 */
  missing: number;
  /** 직원 × 교육 칸 기준 이수율 (대상 제외 칸은 빼고 셈) */
  rate: number | null;
}

export interface Dashboard {
  year: number;
  /** 직원 × 교육 칸 기준 */
  overall: { target: number; done: number; partial: number; rate: number | null };
  /** total: 교육 대상 직원 (모든 교육이 대상 제외인 직원은 뺌) */
  employees: { total: number; complete: number; missing: number };
  /** 그해 검수 대기 이수증 */
  drafts: number;
  trainings: Training[];
  summary: StatusTrainingSummary[];
  departments: DashboardDepartment[];
}

// ── 내보내기 ────────────────────────────────────────────────────

export const ZIP_LAYOUTS = ['training', 'department', 'employee'] as const;
export type ZipLayout = (typeof ZIP_LAYOUTS)[number];

export interface ExportSummary {
  year: number;
  /** 확정한 이수증 수 (이 범위) */
  certificates: number;
  /** 아직 검수 대기라 내보내기에 들어가지 않는 이수증 */
  drafts: number;
  trainings: { trainingId: number; name: string; certificates: number }[];
  employees: { employeeId: number; name: string; empNo: string | null; departmentName: string | null; certificates: number }[];
}

// ── 제출 양식(엑셀)에 채우기 ─────────────────────────────────────
// 기관·부서가 정한 명단형 엑셀 양식에 직원 한 줄씩 이수 현황을 써 넣는다.

export const FORM_PERSON_FIELDS = ['seq', 'name', 'organization', 'department', 'position', 'empNo', 'birthDate', 'empType'] as const;
export type FormPersonField = (typeof FORM_PERSON_FIELDS)[number];
export const FORM_PERSON_LABELS: Record<FormPersonField, string> = {
  seq: '연번',
  name: '성명',
  organization: '소속 기관',
  department: '부서',
  position: '직급',
  empNo: '사번',
  birthDate: '생년월일',
  empType: '직종',
};

export const FORM_TRAINING_FORMATS = ['mark', 'status', 'date', 'hours', 'course', 'provider', 'certNo'] as const;
export type FormTrainingFormat = (typeof FORM_TRAINING_FORMATS)[number];
export const FORM_TRAINING_FORMAT_LABELS: Record<FormTrainingFormat, string> = {
  mark: '이수 표시 (O·X 등)',
  status: '이수 상태 (이수·부분이수·미이수)',
  date: '이수일',
  hours: '이수 시간',
  course: '과정명',
  provider: '교육기관',
  certNo: '수료증 번호',
};

/** 이수 표시 모양: 이수 / 미이수(부분이수 포함). 대상 제외는 "-" */
export const FORM_MARK_STYLES = ['ox', 'circle', 'word', 'yn'] as const;
export type FormMarkStyle = (typeof FORM_MARK_STYLES)[number];
export const FORM_MARKS: Record<FormMarkStyle, { done: string; notDone: string }> = {
  ox: { done: 'O', notDone: 'X' },
  circle: { done: '○', notDone: '×' },
  word: { done: '이수', notDone: '미이수' },
  yn: { done: 'Y', notDone: 'N' },
};

/** 양식의 한 열에 무엇을 넣을지 */
export type FormColumnFill =
  | { kind: 'none' }
  | { kind: 'person'; field: FormPersonField }
  | { kind: 'training'; trainingId: number; format: FormTrainingFormat }
  /** 아직 이수하지 않은 교육 이름들 (비고 칸 등) */
  | { kind: 'missing' };

export interface FormColumn {
  /** 열 번호 (A = 1) */
  col: number;
  /** 엑셀 열 이름 (A, B, …) */
  letter: string;
  /** 양식 머리글. 두 줄 머리글은 "성희롱 예방교육 › 이수일"처럼 잇는다 */
  label: string;
  fill: FormColumnFill;
}

/** 양식에서 찾은 자리 (줄 번호는 엑셀과 같이 1부터) */
export interface FormLayout {
  sheetName: string;
  headerFirst: number;
  headerLast: number;
  /** 첫 사람을 쓸 줄 */
  dataFirst: number;
  /** 합계·서명란이 시작하는 줄 (그 위까지가 미리 그려 둔 빈 줄). 없으면 마지막 줄 다음 */
  footerRow: number;
}

export interface FormAnalysis {
  workbookKind?: 'generic' | 'statutory16';
  uploadId: string;
  fileName: string;
  sheets: string[];
  layout: FormLayout;
  columns: FormColumn[];
  /** 양식에서 찾은 자리표시 ({부서명} 등) */
  placeholders: string[];
  warnings: string[];
  /** 화면에 양식 모양을 보여 주는 앞부분 (줄 번호와 칸 글자) */
  rows: { row: number; cells: string[] }[];
}

export interface FormTemplate {
  workbookKind?: 'generic' | 'statutory16';
  id: number;
  name: string;
  /** 없으면 모든 부서가 함께 쓰는 양식 */
  departmentId: number | null;
  departmentName: string | null;
  fileName: string;
  layout: FormLayout;
  columns: FormColumn[];
  markStyle: FormMarkStyle;
  createdBy: string | null;
  updatedAt: string;
  /** 지금 사용자가 고치거나 지울 수 있는지 */
  canEdit: boolean;
}

/** 열 설정으로 첫 몇 명을 채워 본 값 (화면 미리보기) */
export interface FormPreview {
  columns: FormColumn[];
  rows: string[][];
  /** 실제로 채울 사람 수 */
  total: number;
}

// ── 감사 로그 ───────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  at: string;
  userLogin: string | null;
  userName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

// ── 보관·파기·백업·점검 ─────────────────────────────────────────

export interface RetentionSettings {
  /** 이수증 자료(원본·쪽 이미지·이수 기록) 보관 연수. 다음 해 1월 1일부터 센다 */
  documentYears: number;
  /** 접속기록 보관 연수 (최소 2년) */
  accessLogYears: number;
  /** 감사 로그(계정·권한 변경 이력 포함) 보관 연수 (최소 3년) */
  auditLogYears: number;
  /** DB 백업본을 몇 개까지 둘지 (하루 1번이면 일수) */
  backupKeep: number;
}

export interface PurgeCandidate {
  year: number;
  batches: number;
  files: number;
  bytes: number;
  pages: number;
  certificates: number;
  exemptions: number;
  /** 함께 지우는 퇴직자 (다른 해 이수 기록이 없는 사람) */
  retiredEmployees: number;
}

export interface RetentionView {
  settings: RetentionSettings;
  minimum: RetentionSettings;
  /** 파기할 수 있는 연도 */
  candidates: PurgeCandidate[];
  thisYear: number;
}

export interface AccessLogEntry {
  id: number;
  at: string;
  userLogin: string | null;
  userName: string | null;
  method: string;
  path: string;
  status: number;
  ip: string | null;
}

export interface AccessLogPage {
  entries: AccessLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/** 접속기록 월 점검 */
export interface AccessReview {
  month: string;
  users: {
    userLogin: string;
    userName: string | null;
    requests: number;
    views: number;
    changes: number;
    downloads: number;
    /** 평일 07~21시 밖(야간·주말) 요청 */
    afterHours: number;
    failedLogins: number;
  }[];
  /** 그달 내려받기와 사유 */
  downloads: { at: string; userLogin: string | null; userName: string | null; action: string; reason: string | null; scope: string | null }[];
  reviewed: { at: string; by: string | null; note: string | null } | null;
}

export interface ChainCheckView {
  ok: boolean;
  checked: number;
  firstId: number | null;
  lastId: number | null;
  trimmed: boolean;
  brokenAt: number | null;
  problem: string | null;
}

export interface LogIntegrity {
  checkedAt: string;
  audit: ChainCheckView;
  access: ChainCheckView;
}

export interface BackupSnapshot {
  file: string;
  at: string;
  bytes: number;
}

export interface BackupStatus {
  dir: string;
  /** 매일 이 시각(한국 시각)에 자동 백업 */
  hour: number;
  last: { at: string; ok: boolean; file: string | null; copiedFiles: number; removedFiles: number; ms: number; error: string | null } | null;
  snapshots: BackupSnapshot[];
  running: boolean;
}

export interface SystemCheck {
  version: string;
  node: string;
  platform: string;
  startedAt: string;
  dataDir: string;
  dbBytes: number;
  freeBytes: number | null;
  totalBytes: number | null;
  https: boolean;
  cookieSecure: boolean;
  host: string;
  port: number;
  /** 스캔본을 읽는 OCR 엔진 */
  ocrEngine: string;
  backup: BackupStatus['last'];
  /** 운영 전에 고칠 점 */
  warnings: string[];
}

export interface BulkConfirmResult {
  confirmed: number;
  skipped: { id: number; reason: string }[];
}

export interface ReviewResetPreview {
  batchId: number | null;
  scopeLabel: string;
  drafts: number;
  incompletePages: number;
  pages: number;
  token: string;
}

export interface ReviewResetResult {
  removed: number;
  resetPages: number;
}

/** 교육별 기준 충족 현황. ready는 안내용이며 미충족·검수 대기는 다운로드를 막지 않는다. */
export interface FinalExportCheck {
  ready: boolean;
  employees: number;
  missingTrainings: string[];
  criteriaWarnings: string[];
  blockers: { employeeId: number; name: string; department: string | null; training: string; hours: number; required: number; unit: string; state: CompletionState }[];
  drafts: number;
}
