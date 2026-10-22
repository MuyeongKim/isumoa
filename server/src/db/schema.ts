import type { Generated } from 'kysely';
import type { EmployeeStatus, ReqType, Role } from '../../../shared/types.ts';

// DB 테이블 구조. 실제 테이블은 migrations/*.sql 파일이 만든다 — 열을 바꾸면 두 곳을 함께 고친다.
// SQLite에는 boolean이 없어서 참/거짓은 0/1 정수로 저장한다.

export interface DepartmentsTable {
  id: Generated<number>;
  name: string;
  sort_order: Generated<number>;
  active: Generated<number>;
  created_at: Generated<string>;
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
}
