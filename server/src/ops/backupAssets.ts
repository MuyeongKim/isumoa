import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface BackupAsset { path: string; sha256: string; bytes: number }

export async function fileHash(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** 백업 DB/manifest 안의 경로로 백업 폴더 밖을 읽지 않는다. */
export function assetPath(root: string, path: string): string {
  if (!/^(files|pages)\//.test(path) || isAbsolute(path) || /[\\:]/.test(path) || path.split('/').some(p => p === '.' || p === '..' || !p)) {
    throw new Error('백업 자료 경로가 올바르지 않습니다.');
  }
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + sep)) throw new Error('백업 자료 경로가 폴더 밖입니다.');
  return full;
}

/** 해당 DB 사본에 필요한 원본·쪽 이미지·미리보기만 검사한다. 원본은 DB에 기록된 해시와도 대조한다. */
export async function snapshotAssets(dbFile: string, root: string): Promise<BackupAsset[]> {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  const required: { path: string; expected?: string }[] = [];
  try {
    for (const f of db.prepare('SELECT stored_name, sha256 FROM files ORDER BY id').all() as { stored_name: string; sha256: string }[]) {
      required.push({ path: `files/${f.stored_name}`, expected: f.sha256 });
    }
    for (const p of db.prepare('SELECT file_id, page_no FROM pages ORDER BY id').all() as { file_id: number; page_no: number }[]) {
      required.push({ path: `pages/${p.file_id}/${p.page_no}.jpg` }, { path: `pages/${p.file_id}/${p.page_no}_thumb.jpg` });
    }
  } finally { db.close(); }
  const assets: BackupAsset[] = [];
  for (const item of required) {
    const file = assetPath(root, item.path);
    let bytes: number;
    try { bytes = (await stat(file)).size; } catch { throw new Error(`백업에 필요한 자료가 없습니다: ${item.path}`); }
    const sha256 = await fileHash(file);
    if (item.expected && sha256 !== item.expected) throw new Error(`원본 파일의 체크섬이 다릅니다: ${item.path}`);
    assets.push({ path: item.path, bytes, sha256 });
  }
  return assets;
}

export function verifyAssets(actual: BackupAsset[], recorded: unknown): void {
  if (!Array.isArray(recorded) || recorded.length !== actual.length) throw new Error('백업 자료의 체크섬 목록이 DB 사본과 맞지 않습니다.');
  const expected = new Map<string, BackupAsset>();
  for (const entry of recorded) {
    if (!entry || typeof entry.path !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || expected.has(entry.path)) {
      throw new Error('백업 자료의 체크섬 기록이 올바르지 않습니다.');
    }
    expected.set(entry.path, entry);
  }
  for (const item of actual) {
    const prior = expected.get(item.path);
    if (!prior || prior.bytes !== item.bytes || prior.sha256 !== item.sha256) throw new Error(`백업 자료가 변경되었거나 손상되었습니다: ${item.path}`);
  }
}
