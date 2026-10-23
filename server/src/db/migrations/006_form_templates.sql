-- 006: 제출 양식(엑셀). 올린 양식 파일과 찾은 자리·열 설정을 둔다.
--   파일을 DB에 함께 두어 백업(VACUUM INTO)에 저절로 들어간다. 양식은 보통 수십 KB.
--   department_id가 없으면 모든 부서가 함께 쓰는 양식.

CREATE TABLE form_templates (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL,
  department_id  INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  file_name      TEXT    NOT NULL,
  file           BLOB    NOT NULL,
  sheet_name     TEXT    NOT NULL,
  header_first   INTEGER NOT NULL,
  header_last    INTEGER NOT NULL,
  data_first     INTEGER NOT NULL,
  footer_row     INTEGER NOT NULL,
  columns        TEXT    NOT NULL,                -- FormColumn[] (JSON)
  mark_style     TEXT    NOT NULL DEFAULT 'ox',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX form_templates_department ON form_templates(department_id);
