import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessLogPage, AccessReview, AuditPage, BackupStatus, LogIntegrity, RetentionView, SystemCheck } from '../../shared/types.ts';
import { pruneLogs, DEFAULT_RETENTION } from '../../server/src/ops/retention.ts';
import { originalPath, pageImagePath } from '../../server/src/storage.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

// 보안·운영: 접속기록, 월 점검, 기록 위·변조 확인, 보관기간·파기, 주민번호 가리기, 백업·복원, 시스템 점검

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let h: Harness;
let backupDir: string;

const cert = (name: string, extra = '') =>
  ['수 료 증', `성 명 : ${name}`, extra, '과 정 명 : 공직자 청렴교육', '이수일자 : 2019. 5. 20.', '교육시간 : 2시간', '가상청렴연수원장'].join('\n');

beforeAll(async () => {
  backupDir = mkdtempSync(join(tmpdir(), 'ecp-backup-'));
  h = await createHarness({ backupDir });
  const dept = await h.db.insertInto('departments').values({ name: '총무과' }).returning('id').executeTakeFirstOrThrow();
  await h.db
    .insertInto('employees')
    .values([
      { name: '오호영', name_key: '오호영', department_id: dept.id, emp_no: '1001', status: 'active', left_on: null },
      { name: '김퇴직', name_key: '김퇴직', department_id: dept.id, emp_no: '1002', status: 'retired', left_on: '2019-06-30' },
      { name: '이퇴직', name_key: '이퇴직', department_id: dept.id, emp_no: '1003', status: 'retired', left_on: '2019-06-30' },
    ])
    .execute();
});

afterAll(async () => {
  await h.close();
  rmSync(backupDir, { recursive: true, force: true });
});

describe('접속기록', () => {
  it('로그인한 사용자의 요청을 남기고, 화면이 자동으로 묻는 요청은 남기지 않는다', async () => {
    await h.send('GET', '/api/employees?q=%EC%98%A4%ED%98%B8%EC%98%81');
    await h.send('GET', '/api/processing');
    await h.app.inject({ method: 'GET', url: '/api/employees' }); // 로그인 안 함
    const page = (await h.send('GET', '/api/access-log?user=admin')).json() as AccessLogPage;
    const paths = page.entries.map((e) => e.path);
    expect(paths).toContain('/api/employees?q=%EC%98%A4%ED%98%B8%EC%98%81');
    expect(paths.some((p) => p.startsWith('/api/processing'))).toBe(false);
    expect(page.entries.every((e) => e.userLogin === 'admin')).toBe(true);
    expect(page.entries[0]).toMatchObject({ method: 'GET', status: 200 });
  });

  it('월 점검: 사용자별 요약과 내려받기 사유, 점검 완료 기록', async () => {
    await h.send('GET', `/api/exports/status.xlsx?year=2026&reason=${encodeURIComponent('연간 이수 현황 보고')}`);
    const month = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
    const review = (await h.send('GET', `/api/access-log/review?month=${month}`)).json() as AccessReview;
    const admin = review.users.find((u) => u.userLogin === 'admin')!;
    expect(admin.requests).toBeGreaterThan(2);
    expect(admin.downloads).toBe(1);
    expect(review.downloads).toEqual([expect.objectContaining({ action: 'export.excel', reason: '연간 이수 현황 보고', scope: '전체 부서' })]);
    expect(review.reviewed).toBeNull();

    await h.send('POST', '/api/access-log/review', { month, note: '이상 없음' });
    const after = (await h.send('GET', `/api/access-log/review?month=${month}`)).json() as AccessReview;
    expect(after.reviewed).toMatchObject({ by: 'admin', note: '이상 없음' });
  });

  it('감사 로그·접속기록 위·변조 확인', async () => {
    const ok = (await h.send('POST', '/api/logs/verify')).json() as LogIntegrity;
    expect(ok.audit).toMatchObject({ ok: true });
    expect(ok.access).toMatchObject({ ok: true });
    expect(ok.access.checked).toBeGreaterThan(0);

    const victim = await h.db.selectFrom('access_log').select(['id', 'path']).orderBy('id').limit(1).executeTakeFirstOrThrow();
    await h.db.updateTable('access_log').set({ path: '/api/고쳐진-기록' }).where('id', '=', victim.id).execute();
    const broken = (await h.send('POST', '/api/logs/verify')).json() as LogIntegrity;
    expect(broken.access).toMatchObject({ ok: false, brokenAt: victim.id });
    await h.db.updateTable('access_log').set({ path: victim.path }).where('id', '=', victim.id).execute();
    expect(((await h.send('POST', '/api/logs/verify')).json() as LogIntegrity).access.ok).toBe(true);
  });

  it('보관기간이 지난 기록은 정리한다', async () => {
    const old = new Date(Date.now() - 3 * 366 * 86_400_000).toISOString();
    await h.db.insertInto('access_log').values({ at: old, method: 'GET', path: '/old', status: 200, prev_hash: 'x', hash: 'y' }).execute();
    const pruned = await pruneLogs(h.db, DEFAULT_RETENTION);
    expect(pruned.access).toBeGreaterThanOrEqual(1);
    expect(await h.db.selectFrom('access_log').select('id').where('path', '=', '/old').executeTakeFirst()).toBeUndefined();
  });
});

describe('주민등록번호', () => {
  it('PDF 글자층에 있어도 뒷자리를 가려 저장한다', async () => {
    const batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
    const file = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from('rrn')]), 'rrn.pdf')).json();
    const pageId = await h.uploadPage(file.fileId, 1, cert('오호영', '주민등록번호 : 810312-1234567'));
    const page = await h.db.selectFrom('pages').select('text_layer').where('id', '=', pageId).executeTakeFirstOrThrow();
    expect(page.text_layer).toContain('810312-1******');
    expect(page.text_layer).not.toContain('1234567');
  });
});

describe('보관기간과 파기', () => {
  let fileId: number;

  beforeAll(async () => {
    // 2019년 묶음: 오호영·김퇴직 이수증, 이퇴직은 2026년에도 이수증이 있다
    const old = (await h.send('POST', '/api/batches', { year: 2019 })).json().id;
    const f = (await h.uploadFile(old, Buffer.concat([PDF, Buffer.from('2019')]), '2019.pdf', 2)).json();
    fileId = f.fileId;
    await h.uploadPage(f.fileId, 1, cert('오호영'));
    await h.uploadPage(f.fileId, 2, cert('김퇴직'));
    const now = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
    const g = (await h.uploadFile(now, Buffer.concat([PDF, Buffer.from('2026')]), '2026.pdf')).json();
    await h.uploadPage(g.fileId, 1, cert('이퇴직').replace('2019. 5. 20.', '2026. 5. 20.'));
    await h.drainQueue();
    const emp = await h.db.selectFrom('employees').select('id').where('name', '=', '오호영').executeTakeFirstOrThrow();
    await h.db.insertInto('exemptions').values({ employee_id: emp.id, training_id: null, year: 2019, reason: '휴직' }).execute();
  });

  it('보관기간은 최소 기준보다 짧게 정할 수 없다', async () => {
    const bad = await h.send('PUT', '/api/retention', { ...DEFAULT_RETENTION, accessLogYears: 1 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('2년');
    expect((await h.send('PUT', '/api/retention', DEFAULT_RETENTION)).statusCode).toBe(200);
  });

  it('보관기간(5년)이 지난 연도만 파기 대상이고, 연도를 입력해야 파기한다', async () => {
    const view = (await h.send('GET', '/api/retention')).json() as RetentionView;
    const y2019 = view.candidates.find((c) => c.year === 2019)!;
    expect(view.candidates.map((c) => c.year)).not.toContain(2026);
    expect(y2019).toMatchObject({ batches: 1, files: 1, pages: 2, certificates: 2, exemptions: 1, retiredEmployees: 1 });

    expect((await h.send('POST', '/api/retention/purge', { year: 2019, confirm: '2018' })).statusCode).toBe(400);
    expect((await h.send('POST', '/api/retention/purge', { year: 2026, confirm: '2026' })).statusCode).toBe(400);

    const stored = await h.db.selectFrom('files').select('stored_name').where('id', '=', fileId).executeTakeFirstOrThrow();
    expect(existsSync(originalPath(h.dataDir, stored.stored_name))).toBe(true);
    const res = await h.send('POST', '/api/retention/purge', { year: 2019, confirm: '2019' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ certificates: 2, fileErrors: 0 });

    expect(await h.db.selectFrom('batches').select('id').where('year', '=', 2019).execute()).toEqual([]);
    expect(await h.db.selectFrom('exemptions').select('id').where('year', '=', 2019).execute()).toEqual([]);
    expect(existsSync(originalPath(h.dataDir, stored.stored_name))).toBe(false);
    expect(existsSync(pageImagePath(h.dataDir, fileId, 1, 'image'))).toBe(false);
    const names = (await h.db.selectFrom('employees').select('name').execute()).map((e) => e.name);
    expect(names).toEqual(expect.arrayContaining(['오호영', '이퇴직']));
    expect(names).not.toContain('김퇴직');

    const log = (await h.send('GET', '/api/audit?category=security')).json() as AuditPage;
    expect(log.entries.find((e) => e.action === 'retention.purge')?.detail).toMatchObject({ year: 2019, certificates: 2 });
  });
});

describe('백업과 복원', () => {
  it('지금 백업: DB 사본(무결성 확인)과 원본 파일 복사, 두 번째는 바뀐 것만', async () => {
    const first = (await h.send('POST', '/api/backups/run')).json() as BackupStatus;
    expect(first.last).toMatchObject({ ok: true, error: null });
    expect(first.last!.copiedFiles).toBeGreaterThan(0);
    expect(first.snapshots).toHaveLength(1);
    expect(readdirSync(join(backupDir, 'db')).some((f) => f.endsWith('.json'))).toBe(true);

    const second = (await h.send('POST', '/api/backups/run')).json() as BackupStatus;
    expect(second.last).toMatchObject({ ok: true, copiedFiles: 0 });
    expect(second.snapshots).toHaveLength(2);
  });

  it('복원 연습(--check)은 백업본을 검사만 하고, 실제 복원(--apply)은 새 데이터 폴더에 되살린다', () => {
    const env = { ...process.env, BACKUP_DIR: backupDir, DATA_DIR: join(h.dataDir, 'restored'), PORT: '39999', ECP_CONFIG: join(backupDir, 'none.json') };
    writeFileSync(env.ECP_CONFIG, '{}');
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'scripts/restore.ts'), ...args], { env, encoding: 'utf8' });

    const check = run('--check');
    expect(check).toContain('DB 무결성 검사        정상');
    expect(check).toContain('감사 로그 이어짐      정상');
    expect(check).toContain('이 백업으로 복원할 수 있습니다');
    expect(existsSync(join(env.DATA_DIR, 'app.db'))).toBe(false);

    expect(() => run('--apply')).toThrow(); // --yes 없이는 하지 않는다
    const applied = run('--apply', '--yes');
    expect(applied).toContain('복원했습니다');
    expect(existsSync(join(env.DATA_DIR, 'app.db'))).toBe(true);
    expect(readdirSync(join(env.DATA_DIR, 'pages')).length).toBeGreaterThan(0);
  });
});

describe('시스템 점검', () => {
  it('상태와 고칠 점을 알려 주고, /api/health는 로그인 없이 답한다', async () => {
    const sys = (await h.send('GET', '/api/system')).json() as SystemCheck;
    expect(sys).toMatchObject({ https: false, cookieSecure: false });
    expect(sys.backup?.ok).toBe(true);
    expect(sys.warnings.some((w) => w.includes('같은 디스크'))).toBe(true); // 테스트는 임시 폴더라 같은 디스크
    const health = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(health.json()).toEqual({ ok: true, application: 'isumoa', protocol: 1, version: 'test' });
  });
});

describe('PC 설치판 끄기', () => {
  it('서버판에서는 끄는 주소가 없다', async () => {
    expect((await h.send('POST', '/api/system/shutdown')).statusCode).toBe(404);
    expect((await h.send('POST', '/api/system/quit', {}, { 'x-shutdown-token': 'x' })).statusCode).toBe(404);
  });

  it('관리자는 화면에서 끄고, 설치 프로그램은 열쇠 파일 값으로만 끈다', async () => {
    const reasons: string[] = [];
    const pc = await createHarness({ desktop: true }, { shutdownToken: 'a'.repeat(48), requestShutdown: (r) => reasons.push(r) });
    try {
      const quit = (token: string) =>
        pc.app.inject({ method: 'POST', url: '/api/system/quit', payload: {}, headers: { 'x-requested-with': 'fetch', 'x-shutdown-token': token } });
      expect((await quit('b'.repeat(48))).statusCode).toBe(403);
      expect((await quit('short')).statusCode).toBe(403);
      expect((await quit('a'.repeat(48))).statusCode).toBe(200);
      expect((await pc.send('POST', '/api/system/shutdown')).statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 400));
      expect(reasons).toEqual(['설치·제거 프로그램 요청', '화면에서 프로그램 끄기']);
      const audit = await pc.db.selectFrom('audit_log').select('action').where('action', '=', 'system.shutdown').execute();
      expect(audit).toHaveLength(1);
      expect((await pc.send('GET', '/api/meta')).json().desktop).toBe(true);
    } finally {
      await pc.close();
    }
  });
});
