import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { Kysely, SqliteDialect, type SqliteDatabase } from 'kysely';
import type { DB } from './schema.ts';

// Node 내장 SQLite(node:sqlite)를 Kysely가 기대하는 형태로 감싼다.
// better-sqlite3 같은 네이티브 모듈 없이 SQLite를 쓰기 위한 작은 어댑터다.

function toParams(params: ReadonlyArray<unknown>): SQLInputValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    return p as SQLInputValue;
  });
}

function wrap(raw: DatabaseSync): SqliteDatabase {
  return {
    close: () => raw.close(),
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        // 결과 열이 있는 문장(SELECT, RETURNING)이면 all()로 행을 돌려받는다
        reader: stmt.columns().length > 0,
        all: (params) => stmt.all(...toParams(params)),
        run: (params) => stmt.run(...toParams(params)),
        iterate: (params) => stmt.iterate(...toParams(params)) as IterableIterator<unknown>,
      };
    },
  };
}

export interface Database {
  raw: DatabaseSync;
  db: Kysely<DB>;
}

/** file에 ':memory:'를 주면 테스트용 메모리 DB를 연다 */
export function openDatabase(file: string): Database {
  const raw = new DatabaseSync(file);
  if (file !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: wrap(raw) }) });
  return { raw, db };
}

export function nowIso(): string {
  return new Date().toISOString();
}
