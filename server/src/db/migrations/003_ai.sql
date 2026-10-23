-- 003: AI 인식 기록
--   pages: AI에 보낸 결과(원본 응답), 모델, 걸린 시간, 실패 사유, 프롬프트 버전
--   certificates: AI가 고른 교육 코드, 인식할 때 남긴 확인할 점

ALTER TABLE pages ADD COLUMN ai_raw TEXT;
ALTER TABLE pages ADD COLUMN ai_model TEXT;
ALTER TABLE pages ADD COLUMN ai_ms INTEGER;
ALTER TABLE pages ADD COLUMN ai_error TEXT;
ALTER TABLE pages ADD COLUMN prompt_version TEXT;

ALTER TABLE certificates ADD COLUMN ai_codes TEXT NOT NULL DEFAULT '[]';
-- 인식할 때 남긴 확인할 점(AI와 규칙이 다르게 읽음 등). 서무가 값을 고치면 더는 보이지 않는다
ALTER TABLE certificates ADD COLUMN notes TEXT NOT NULL DEFAULT '[]';
