-- 초기화한 검수 대기 결과를 오래 실행 중인 작업이 다시 만들지 않도록 세대를 구분한다.
ALTER TABLE pages ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0;
