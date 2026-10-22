-- 001: 기본 테이블 — 부서, 사용자, 세션, 직원, 교육 과정, 대상 제외, 설정, 감사 로그
-- 시각은 모두 UTC ISO 8601 문자열(예: 2026-10-22T05:00:00.000Z)로 저장한다.

CREATE TABLE departments (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY,
  login_id              TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name                  TEXT    NOT NULL,
  role                  TEXT    NOT NULL CHECK (role IN ('admin', 'clerk')),
  password_hash         TEXT    NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  active                INTEGER NOT NULL DEFAULT 1,
  failed_logins         INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  last_login_at         TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 서무 ↔ 담당 부서 (한 서무가 여러 부서를 맡을 수 있다)
CREATE TABLE user_departments (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id  INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

-- id는 쿠키에 담긴 토큰의 SHA-256 값이다. 토큰 원문은 저장하지 않는다.
CREATE TABLE sessions (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL,
  last_seen_at  TEXT    NOT NULL,
  expires_at    TEXT    NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE employees (
  id             INTEGER PRIMARY KEY,
  emp_no         TEXT    UNIQUE,                 -- 사번 (없으면 NULL)
  name           TEXT    NOT NULL,
  name_key       TEXT    NOT NULL,               -- 공백을 뺀 이름 (검색·매칭용)
  department_id  INTEGER REFERENCES departments(id),
  position       TEXT,                           -- 직급·직위
  emp_type       TEXT,                           -- 직종 (공무원·공무직 등)
  birth_date     TEXT,                           -- YYYY-MM-DD
  status         TEXT    NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'leave', 'dispatched', 'retired')),
  hired_on       TEXT,
  left_on        TEXT,
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX employees_name_key ON employees(name_key);
CREATE INDEX employees_department ON employees(department_id);

CREATE TABLE trainings (
  id           INTEGER PRIMARY KEY,
  code         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  category     TEXT,
  legal_basis  TEXT,
  req_type     TEXT    NOT NULL CHECK (req_type IN ('count', 'hours')),  -- 연 N회 / 연 N시간
  req_value    REAL    NOT NULL,
  keywords     TEXT    NOT NULL DEFAULT '[]',     -- 과정명에서 찾을 단어 (JSON 배열)
  from_year    INTEGER,                           -- 적용 시작 연도 (NULL이면 제한 없음)
  to_year      INTEGER,                           -- 적용 종료 연도
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 휴직·파견 등으로 해당 연도 교육 대상에서 빼는 경우 (training_id가 NULL이면 모든 교육)
CREATE TABLE exemptions (
  id           INTEGER PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  training_id  INTEGER REFERENCES trainings(id) ON DELETE CASCADE,
  year         INTEGER NOT NULL,
  reason       TEXT    NOT NULL,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX exemptions_unique ON exemptions(employee_id, IFNULL(training_id, 0), year);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL                            -- JSON
);

CREATE TABLE audit_log (
  id           INTEGER PRIMARY KEY,
  at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  user_id      INTEGER,
  user_login   TEXT,
  action       TEXT    NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  detail       TEXT,                              -- JSON
  ip           TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);
