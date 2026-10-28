-- 명단 삭제는 휴지통으로: 이수증·직원 연결을 유지하고 복원할 수 있게 한다.
ALTER TABLE departments ADD COLUMN deleted_at TEXT;
ALTER TABLE employees ADD COLUMN deleted_at TEXT;
ALTER TABLE employees ADD COLUMN deleted_department_id INTEGER REFERENCES departments(id);
CREATE INDEX employees_deleted ON employees(deleted_at);
