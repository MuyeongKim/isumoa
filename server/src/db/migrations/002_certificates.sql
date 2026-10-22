-- 002: 이수증 올리기·처리·검수
--   batches(올린 묶음) → files(원본 파일) → pages(쪽마다 이미지·글자) → certificates(검수 단위)
--   jobs: 쪽 처리 대기열, course_mappings: 서무가 확정하며 쌓이는 "과정명 → 교육" 매핑

CREATE TABLE batches (
  id          INTEGER PRIMARY KEY,
  year        INTEGER NOT NULL,                  -- 대상 연도
  title       TEXT,                              -- 메모 (예: 상반기 폭력예방교육)
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE files (
  id              INTEGER PRIMARY KEY,
  batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  original_name   TEXT    NOT NULL,
  stored_name     TEXT    NOT NULL,              -- 디스크에 저장한 이름 (uuid)
  mime            TEXT    NOT NULL,
  size            INTEGER NOT NULL,
  sha256          TEXT    NOT NULL,
  page_count      INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX files_batch ON files(batch_id);
CREATE INDEX files_sha256 ON files(sha256);

CREATE TABLE pages (
  id          INTEGER PRIMARY KEY,
  file_id     INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page_no     INTEGER NOT NULL,                  -- 1부터
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  text_layer  TEXT,                              -- PDF에 들어 있던 글자 (스캔본이면 거의 없음)
  ocr_text    TEXT,                              -- OCR로 읽은 글자
  route       TEXT,                              -- text | ocr | manual
  state       TEXT    NOT NULL DEFAULT 'queued'
                      CHECK (state IN ('queued', 'processing', 'done', 'error')),
  error       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (file_id, page_no)
);

CREATE TABLE certificates (
  id              INTEGER PRIMARY KEY,
  batch_id        INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  page_id         INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'excluded')),
  employee_id     INTEGER REFERENCES employees(id),
  person_name     TEXT,                          -- 이수증에 적힌 이름 (읽은 그대로)
  person_birth    TEXT,                          -- 이수증에 적힌 생년월일 (YYYY-MM-DD)
  person_dept     TEXT,                          -- 이수증에 적힌 소속
  course_title    TEXT,
  provider        TEXT,
  cert_no         TEXT,
  completed_on    TEXT,                          -- 이수일 YYYY-MM-DD
  hours           REAL,                          -- 이수증의 교육시간
  hours_text      TEXT,                          -- 읽은 그대로 (예: 2차시)
  year            INTEGER,                       -- 인정 연도
  flags           TEXT    NOT NULL DEFAULT '[]', -- 확인할 점 JSON
  source          TEXT    NOT NULL DEFAULT 'rules',  -- 값을 채운 방법: rules | manual
  dept_snapshot   TEXT,                          -- 확정 당시 직원의 부서
  exclude_reason  TEXT,
  confirmed_by    INTEGER REFERENCES users(id),
  confirmed_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX certificates_batch ON certificates(batch_id, status);
CREATE INDEX certificates_employee ON certificates(employee_id, status, year);

-- 이수증 1장이 여러 교육으로 인정될 수 있다 (예: 4대폭력 통합교육)
CREATE TABLE certificate_trainings (
  certificate_id  INTEGER NOT NULL REFERENCES certificates(id) ON DELETE CASCADE,
  training_id     INTEGER NOT NULL REFERENCES trainings(id),
  credited_hours  REAL,                          -- 이 교육으로 인정하는 시간
  PRIMARY KEY (certificate_id, training_id)
);

CREATE TABLE course_mappings (
  title_key      TEXT    NOT NULL,               -- 정리한 과정명
  training_id    INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
  confirmations  INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (title_key, training_id)
);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL,                  -- process-page
  page_id     INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  state       TEXT    NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'done', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  run_after   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_error  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX jobs_pick ON jobs(state, run_after);
