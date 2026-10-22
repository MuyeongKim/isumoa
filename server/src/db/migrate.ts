import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export interface MigrateOptions {
  /** 이미 쓰던 DB를 바꾸기 전에 복사본을 남길 폴더 (테스트에서는 생략) */
  backupDir?: string;
}

/**
 * migrations 폴더의 `번호_이름.sql` 파일을 번호 순서대로 한 번씩 적용한다.
 * 적용 기록은 schema_migrations 테이블에 남긴다.
 */
export function runMigrations(raw: DatabaseSync, options: MigrateOptions = {}): string[] {
  raw.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL
  )`);

  const applied = new Set(
    raw.prepare('SELECT version FROM schema_migrations').all().map((row) => String(row.version)),
  );
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.+\.sql$/.test(file) && !applied.has(file))
    .sort();
  if (pending.length === 0) return [];

  // 업그레이드(이미 적용된 기록이 있음)라면 바꾸기 전에 DB 전체를 백업한다
  if (applied.size > 0 && options.backupDir) {
    mkdirSync(options.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(options.backupDir, `app-before-${pending[0].replace('.sql', '')}-${stamp}.db`);
    raw.prepare('VACUUM INTO ?').run(target);
  }

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    raw.exec('BEGIN');
    try {
      raw.exec(sql);
      raw.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw new Error(`DB 마이그레이션 실패 (${file}): ${(err as Error).message}`);
    }
  }
  return pending;
}
