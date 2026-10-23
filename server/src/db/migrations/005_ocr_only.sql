-- 005: AI(LLM) 기능을 뺐다 (OCR로만 판독).
--   AI에 보냈다 받은 원본 응답(개인정보 포함)과 AI 설정(API 키 포함)을 지우고 AI 열을 없앤다.
--   ocr_engine: 어떤 OCR로 읽었는지. 엔진이 바뀌면(tesseract → kordoc) 다시 읽기 때 새 엔진으로 읽는다.

UPDATE pages SET route = 'text' WHERE route = 'ai-text';
UPDATE pages SET route = 'ocr' WHERE route IN ('ai-ocr', 'ai-vision');

ALTER TABLE pages DROP COLUMN ai_raw;
ALTER TABLE pages DROP COLUMN ai_model;
ALTER TABLE pages DROP COLUMN ai_ms;
ALTER TABLE pages DROP COLUMN ai_error;
ALTER TABLE pages DROP COLUMN prompt_version;
ALTER TABLE certificates DROP COLUMN ai_codes;

DELETE FROM settings WHERE key = 'ai';

-- 검수 대기 이수증에 남은 AI 관련 확인할 점은 지운다 (다음 계산 때 OCR 기준으로 다시 붙음)
UPDATE certificates SET notes = '[]' WHERE status = 'draft';

ALTER TABLE pages ADD COLUMN ocr_engine TEXT;
UPDATE pages SET ocr_engine = 'tesseract' WHERE ocr_text IS NOT NULL;
