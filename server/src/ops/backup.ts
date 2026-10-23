import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql, type Kysely } from 'kysely';
import type { BackupSnapshot, BackupStatus } from '../../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';

// 백업: backupDir 아래에
//   db/app-20261023-020000.db (+ .json)  DB 사본 (최근 N개만 둔다)
//   files/, pages/                       원본 파일·쪽 이미지 (바뀐 것만 복사, 파기된 것은 지움)
// DB 사본은 SQLite의 VACUUM INTO로 만들어 서버를 멈추지 않고도 일관된 상태로 뜬다.
// 복원은 서버를 멈추고 restore 스크립트로 한다 (scripts/restore.ts).

export type BackupResult = NonNullable<BackupStatus['last']>;

let running = false;

function stamp(now: Date): string {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(now);
  return parts.replace(/[-:]/g, '').replace(' ', '-');
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function listFiles(root: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  let entries: string[] = [];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    return result;
  }
  for (const rel of entries) {
    const s = await stat(join(root, rel));
    if (s.isFile()) result.set(rel, s.size);
  }
  return result;
}

/** source를 target에 맞춰 둔다: 없거나 크기가 다른 파일은 복사, source에 없는 파일은 지운다 */
export async function mirror(source: string, target: string): Promise<{ copied: number; removed: number }> {
  const [src, dst] = [await listFiles(source), await listFiles(target)];
  let copied = 0;
  let removed = 0;
  for (const [rel, size] of src) {
    if (dst.get(rel) === size) continue;
    await mkdir(dirname(join(target, rel)), { recursive: true });
    await copyFile(join(source, rel), join(target, rel));
    copied++;
  }
  for (const rel of dst.keys()) {
    if (src.has(rel)) continue;
    await rm(join(target, rel), { force: true });
    removed++;
  }
  return { copied, removed };
}

export async function listSnapshots(backupDir: string): Promise<BackupSnapshot[]> {
  const dir = join(backupDir, 'db');
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const snapshots = await Promise.all(
    names
      .filter((n) => /^app-\d{8}-\d{6}\.db$/.test(n))
      .map(async (file) => {
        const s = await stat(join(dir, file));
        return { file, at: s.mtime.toISOString(), bytes: s.size };
      }),
  );
  return snapshots.sort((a, b) => b.file.localeCompare(a.file));
}

/** DB 사본이 온전한지 (SQLite 무결성 검사) */
export function checkSnapshot(file: string): string {
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    return String(copy.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'unknown');
  } finally {
    copy.close();
  }
}

export async function runBackup(db: Kysely<DB>, config: AppConfig, keep: number, now = new Date()): Promise<BackupResult> {
  if (running) throw new Error('이미 백업하는 중입니다.');
  running = true;
  const started = Date.now();
  const result: BackupResult = { at: now.toISOString(), ok: false, file: null, copiedFiles: 0, removedFiles: 0, ms: 0, error: null };
  try {
    const dbDir = join(config.backupDir, 'db');
    await mkdir(dbDir, { recursive: true });
    const file = `app-${stamp(now)}.db`;
    const target = join(dbDir, file);
    // Kysely를 거쳐 실행해야 다른 요청의 트랜잭션 도중에 끼어들지 않는다
    await sql`VACUUM INTO ${target}`.execute(db);
    const integrity = checkSnapshot(target);
    if (integrity !== 'ok') throw new Error(`DB 사본 무결성 검사 실패: ${integrity}`);

    for (const folder of ['files', 'pages']) {
      const m = await mirror(join(config.dataDir, folder), join(config.backupDir, folder));
      result.copiedFiles += m.copied;
      result.removedFiles += m.removed;
    }
    await writeFile(
      join(dbDir, file.replace(/\.db$/, '.json')),
      `${JSON.stringify({ file, at: result.at, sha256: await sha256(target), bytes: (await stat(target)).size, integrity }, null, 2)}\n`,
    );

    // 오래된 DB 사본 정리 (파기한 자료가 백업에 오래 남지 않도록)
    for (const old of (await listSnapshots(config.backupDir)).slice(Math.max(keep, 1))) {
      await rm(join(dbDir, old.file), { force: true });
      await rm(join(dbDir, old.file.replace(/\.db$/, '.json')), { force: true });
    }
    Object.assign(result, { ok: true, file });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    running = false;
    result.ms = Date.now() - started;
    await setSetting(db, 'backupLast', result);
  }
  return result;
}

export async function backupStatus(db: Kysely<DB>, config: AppConfig): Promise<BackupStatus> {
  return {
    dir: config.backupDir,
    hour: config.backupHour,
    last: await getSetting<BackupResult | null>(db, 'backupLast', null),
    snapshots: await listSnapshots(config.backupDir),
    running,
  };
}
