import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBackup, listSnapshots } from '../../server/src/ops/backup.ts';
import { snapshotAssets, verifyAssets } from '../../server/src/ops/backupAssets.ts';
import { createHarness, PDF, type Harness } from './harness.ts';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let h: Harness, dir: string, saved: string;
const fixed = new Date('2026-10-28T07:00:00.000Z');
const hash = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
function check(backup: string, target = join(dir, 'target'), apply = false, port = 47799) {
  const cfg = join(dir, 'restore-config.json');
  writeFileSync(cfg, JSON.stringify({ dataDir: target, backupDir: backup, host: '::1', port }));
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts/restore.ts'), ...(apply ? ['--apply', '--yes'] : ['--check'])], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ECP_CONFIG: cfg, DATA_DIR: target, BACKUP_DIR: backup, HOST: '::1', PORT: String(port) },
  });
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'isumoa-integrity-'));
  h = await createHarness({ backupDir: join(dir, 'backups') });
  const batch = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const file = (await h.uploadFile(batch, PDF, '가상수료증.pdf')).json().fileId;
  await h.uploadPage(file, 1, '수 료 증\n성명: 가상직원\n과정명: 청렴교육\n2026. 4. 2.\n2시간');
  const backup = await runBackup(h.db, h.config, 30, fixed);
  expect(backup.ok).toBe(true);
  saved = backup.file!;
});
afterEach(async () => { await h.close(); rmSync(dir, { recursive: true, force: true }); });

describe('백업과 실제 복원의 자료 무결성', () => {
  it('같은 초에 여러 백업을 보존하고 같은 크기로 손상된 백업 원본을 다음 백업에서 고친다', async () => {
    const second = await runBackup(h.db, h.config, 30, fixed);
    expect(second.ok).toBe(true);
    expect(second.file).not.toBe(saved);
    expect((await listSnapshots(h.config.backupDir))[0].file).toBe(second.file);
    const assets = await snapshotAssets(join(h.config.backupDir, 'db', saved), h.config.backupDir);
    expect(assets).toHaveLength(3);
    const file = join(h.config.backupDir, assets[0].path), bytes = readFileSync(file); bytes[0] ^= 1; writeFileSync(file, bytes);
    const third = await runBackup(h.db, h.config, 30, fixed);
    expect(third.ok).toBe(true);
    expect(third.copiedFiles).toBe(1);
    expect(hash(file)).toBe(assets[0].sha256);
  });

  it('백업 원본·쪽·미리보기의 누락 또는 같은 크기 손상으로는 복원 가능 판정을 내리지 않는다', async () => {
    const baseline = h.config.backupDir;
    const assets = await snapshotAssets(join(baseline, 'db', saved), baseline);
    for (const [index, asset] of assets.entries()) for (const missing of [false, true]) {
      const backup = join(dir, `variant-${index}-${missing}`); cpSync(baseline, backup, { recursive: true });
      const file = join(backup, asset.path);
      if (missing) rmSync(file); else { const bytes = readFileSync(file); bytes[Math.floor(bytes.length / 2)] ^= 1; writeFileSync(file, bytes); }
      const result = check(backup);
      expect(result.status, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).not.toContain('이 백업으로 복원할 수 있습니다');
      expect(existsSync(join(dir, 'target/app.db'))).toBe(false);
    }
  });

  it('기존 저장소의 누락·손상을 백업하기 전에 잡아 이전 정상 백업 원본을 보존한다', async () => {
    const f = (await h.db.selectFrom('files').selectAll().executeTakeFirstOrThrow()).stored_name;
    const original = join(h.dataDir, 'files', f), destination = join(h.config.backupDir, 'files', f), prior = hash(destination);
    rmSync(original);
    const result = await runBackup(h.db, h.config, 30, new Date(fixed.getTime() + 1000));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('필요한 자료가 없습니다');
    expect(hash(destination)).toBe(prior);
  });

  it('실제 복원은 같은 크기의 손상 파일을 고치고 원래 DB를 복구용으로 보존한다', () => {
    const target = join(dir, 'restore-target'); mkdirSync(target);
    const original = new DatabaseSync(join(target, 'app.db')); original.exec('CREATE TABLE marker (n INTEGER); INSERT INTO marker VALUES (42)'); original.close();
    const oldHash = hash(join(target, 'app.db'));
    cpSync(join(h.config.backupDir, 'files'), join(target, 'files'), { recursive: true });
    const backupDb = new DatabaseSync(join(h.config.backupDir, 'db', saved), { readOnly: true });
    const stored = backupDb.prepare('SELECT stored_name FROM files LIMIT 1').get()!.stored_name as string;
    backupDb.close();
    const file = join(h.config.backupDir, 'files', stored);
    const targetFile = join(target, 'files', file.split('/').at(-1)!); const bytes = readFileSync(targetFile); bytes[0] ^= 1; writeFileSync(targetFile, bytes);
    const result = check(h.config.backupDir, target, true);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(hash(targetFile)).toBe(hash(file));
    expect(hash(join(target, 'app.db'))).toBe(hash(join(h.config.backupDir, 'db', saved)));
    const kept = result.stdout.match(/원래 DB는 (.*) 에 옮겨/)!;
    expect(hash(join(kept[1], 'app.db'))).toBe(oldHash);
  });

  it('IPv6로 서버가 실행 중이면 실제 복원을 거부하고 기존 DB를 유지한다', async () => {
    const server = createServer(socket => socket.end());
    await new Promise<void>(resolve => server.listen(0, '::1', resolve));
    try {
      const port = (server.address() as { port: number }).port, target = join(dir, 'running-target'); mkdirSync(target); writeFileSync(join(target, 'app.db'), 'original-untouched');
      const prior = hash(join(target, 'app.db')), result = check(h.config.backupDir, target, true, port);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('서버가 실행 중입니다');
      expect(hash(join(target, 'app.db'))).toBe(prior);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('DB에 필요한 자료와 manifest 목록이 다르면 검사에 실패한다', async () => {
    const actual = await snapshotAssets(join(h.config.backupDir, 'db', saved), h.config.backupDir);
    expect(() => verifyAssets(actual, actual.slice(1))).toThrow('목록');
    expect(() => verifyAssets(actual, actual.map((a, i) => i ? a : { ...a, path: '../outside' }))).toThrow('손상');
  });
});
