-- 교육 삭제 시 이수증·인정 내역·양식 연결을 보관하고 복원한다.
ALTER TABLE trainings ADD COLUMN deleted_at TEXT;
