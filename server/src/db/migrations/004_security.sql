-- 004: 보안·운영
--   access_log: 접속기록. 로그인한 사용자의 요청(조회·내려받기 포함)을 남긴다
--   prev_hash·hash: 앞 기록의 hash를 이어 붙여 계산한 값. 중간 기록을 고치거나 지우면 이어짐이 끊겨 드러난다
--   (기존 감사 로그는 다음 실행 때 서버가 hash를 채운다)

CREATE TABLE access_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT    NOT NULL,
  user_id    INTEGER,
  user_login TEXT,
  method     TEXT    NOT NULL,
  path       TEXT    NOT NULL,                   -- 주소 (검색 조건 포함)
  status     INTEGER NOT NULL,
  ip         TEXT,
  ms         INTEGER,
  prev_hash  TEXT    NOT NULL,
  hash       TEXT    NOT NULL
);
CREATE INDEX access_log_at ON access_log(at);
CREATE INDEX access_log_user ON access_log(user_login, at);

ALTER TABLE audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE audit_log ADD COLUMN hash TEXT;
CREATE INDEX audit_log_action ON audit_log(action, at);
