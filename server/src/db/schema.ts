import type { Generated } from 'kysely';
import type { CertificateStatus, EmployeeStatus, ReqType, Role } from '../../../shared/types.ts';

// DB 테이블 구조. 실제 테이블은 migrations/*.sql 파일이 만든다 — 열을 바꾸면 두 곳을 함께 고친다.
// SQLite에는 boolean이 없어서 참/거짓은 0/1 정수로 저장한다.

export interface DepartmentsTable {
  id: Generated<number>;
  name: string;
  sort_order: Generated<number>;
  active: Generated<number>;
  created_at: Generated<string>;
  deleted_at: Generated<string | null>;
}

export interface UsersTable {
  id: Generated<number>;
  login_id: string;
  name: string;
  role: Role;
  password_hash: string;
  must_change_password: Generated<number>;
  active: Generated<number>;
  failed_logins: Generated<number>;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface UserDepartmentsTable {
  user_id: number;
  department_id: number;
}

export interface SessionsTable {
  id: string;
  user_id: number;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip: string | null;
  user_agent: string | null;
}

export interface EmployeesTable {
  id: Generated<number>;
  emp_no: string | null;
  name: string;
  name_key: string;
  department_id: number | null;
  position: string | null;
  emp_type: string | null;
  birth_date: string | null;
  status: Generated<EmployeeStatus>;
  hired_on: string | null;
  left_on: string | null;
  note: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: Generated<string | null>;
  deleted_department_id: Generated<number | null>;
}

export interface TrainingsTable {
  id: Generated<number>;
  code: string;
  name: string;
  category: string | null;
  legal_basis: string | null;
  req_type: ReqType;
  req_value: number;
  /** JSON 문자열 배열 */
  keywords: Generated<string>;
  from_year: number | null;
  to_year: number | null;
  active: Generated<number>;
  sort_order: Generated<number>;
  note: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
  deleted_at: Generated<string | null>;
}

export interface ExemptionsTable {
  id: Generated<number>;
  employee_id: number;
  training_id: number | null;
  year: number;
  reason: string;
  created_by: number | null;
  created_at: Generated<string>;
}

export interface SettingsTable {
  key: string;
  /** JSON 문자열 */
  value: string;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: Generated<string>;
  user_id: number | null;
  user_login: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  prev_hash: string | null;
  hash: string | null;
}

export interface AccessLogTable {
  id: Generated<number>;
  at: string;
  user_id: number | null;
  user_login: string | null;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  ms: number | null;
  prev_hash: string;
  hash: string;
}

export interface BatchesTable {
  id: Generated<number>;
  year: number;
  title: string | null;
  created_by: number;
  created_at: Generated<string>;
}

export interface FilesTable {
  id: Generated<number>;
  batch_id: number;
  original_name: string;
  stored_name: string;
  mime: string;
  size: number;
  sha256: string;
  page_count: number;
  created_at: Generated<string>;
}

export type PageState = 'queued' | 'processing' | 'done' | 'error';

export interface PagesTable {
  id: Generated<number>;
  file_id: number;
  page_no: number;
  width: number;
  height: number;
  text_layer: string | null;
  ocr_text: string | null;
  route: string | null;
  state: Generated<PageState>;
  error: string | null;
  /** 어떤 OCR로 읽었는지 (kordoc / tesseract) */
  ocr_engine: string | null;
  created_at: Generated<string>;
  review_generation: Generated<number>;
}

export interface CertificatesTable {
  id: Generated<number>;
  batch_id: number;
  page_id: number;
  status: Generated<CertificateStatus>;
  employee_id: number | null;
  person_name: string | null;
  person_birth: string | null;
  person_dept: string | null;
  course_title: string | null;
  provider: string | null;
  cert_no: string | null;
  completed_on: string | null;
  hours: number | null;
  hours_text: string | null;
  year: number | null;
  /** JSON: CertificateFlag[] */
  flags: Generated<string>;
  source: Generated<string>;
  dept_snapshot: string | null;
  /** JSON: CertificateFlag[] — 인식할 때 남긴 확인할 점 (source가 manual이 되면 쓰지 않음) */
  notes: Generated<string>;
  exclude_reason: string | null;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface CertificateTrainingsTable {
  certificate_id: number;
  training_id: number;
  credited_hours: number | null;
}

export interface CourseMappingsTable {
  title_key: string;
  training_id: number;
  confirmations: Generated<number>;
  updated_at: Generated<string>;
}

export interface JobsTable {
  review_generation: Generated<number>;
  id: Generated<number>;
  kind: string;
  page_id: number;
  state: Generated<'queued' | 'running' | 'done' | 'failed'>;
  attempts: Generated<number>;
  run_after: Generated<string>;
  last_error: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface FormTemplatesTable {
  id: Generated<number>;
  name: string;
  department_id: number | null;
  file_name: string;
  file: Uint8Array;
  sheet_name: string;
  header_first: number;
  header_last: number;
  data_first: number;
  footer_row: number;
  /** FormColumn[] (JSON) */
  columns: string;
  mark_style: Generated<string>;
  created_by: number | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface DB {
  departments: DepartmentsTable;
  users: UsersTable;
  user_departments: UserDepartmentsTable;
  sessions: SessionsTable;
  employees: EmployeesTable;
  trainings: TrainingsTable;
  exemptions: ExemptionsTable;
  settings: SettingsTable;
  audit_log: AuditLogTable;
  access_log: AccessLogTable;
  batches: BatchesTable;
  files: FilesTable;
  pages: PagesTable;
  certificates: CertificatesTable;
  certificate_trainings: CertificateTrainingsTable;
  course_mappings: CourseMappingsTable;
  jobs: JobsTable;
  form_templates: FormTemplatesTable;
}
