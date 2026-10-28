import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CertificateDetail, CertificateInput, CertificateListItem, ReviewResetPreview } from '../../shared/types.ts';
import { processPage } from '../../server/src/certs/processPage.ts';
import { claimNextJob, failJob, finishJob } from '../../server/src/jobs/queue.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let seq: number;
const text = '수 료 증\n성명: 홍길동\n과정명: 청렴교육\n교육기간: 2026.04.01.~2026.04.01.\n교육시간: 2시간\n위 사람은 교육과정을 이수하였기에 이 증서를 수여합니다.\n가상연수원장';
beforeEach(async () => { h = await createHarness(); seq = 0; const departmentId = (await h.send('POST', '/api/departments', { name: '가상부서' })).json().id; expect((await h.send('POST', '/api/employees', { name: '홍길동', departmentId })).statusCode).toBe(200); });
afterEach(async () => { await h.close(); });
async function batch() { return (await h.send('POST', '/api/batches', { year: 2026, title: '가상 검수 자료' })).json().id as number; }
async function page(batchId: number, content = text) {
  const file = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from(String(++seq))]), `가상${seq}.pdf`)).json().fileId;
  return h.uploadPage(file, 1, content);
}
async function preview(batchId?: number): Promise<ReviewResetPreview> { return (await h.send('GET', `/api/certificates/reset-preview${batchId ? `?batchId=${batchId}` : ''}`)).json(); }
async function reset(p: ReviewResetPreview) { return h.send('POST', '/api/certificates/reset-drafts', { token: p.token, ...(p.batchId ? { batchId: p.batchId } : {}) }); }
async function rows(): Promise<CertificateListItem[]> { return (await h.send('GET', '/api/certificates')).json(); }
async function input(id: number): Promise<CertificateInput> {
  const d = (await h.send('GET', `/api/certificates/${id}`)).json() as CertificateDetail;
  return { employeeId: d.employee!.id, credits: d.credits, completedOn: d.completedOn, hours: d.hours, courseTitle: d.courseTitle, provider: d.provider, certNo: d.certNo, year: d.year };
}

describe('검수 대기 초기화', () => {
  it('대기·오류·진행 작업만 비우고 확정·제외·원본·명단·교육·학습매핑을 보존한다', async () => {
    const b = await batch();
    for (let i = 0; i < 3; i++) await page(b);
    await h.drainQueue();
    const [approved, excluded] = await rows();
    expect((await h.send('POST', `/api/certificates/${approved.id}/confirm`, await input(approved.id))).statusCode).toBe(200);
    await h.send('POST', `/api/certificates/${excluded.id}/exclude`, { reason: '대상 밖' });
    const queued = await page(b);
    const failed = await page(b);
    await h.db.updateTable('pages').set({ state: 'error', error: '가상 실패' }).where('id', '=', failed).execute();
    const protectedRows = await h.db.selectFrom('certificates').selectAll().where('status', '!=', 'draft').orderBy('id').execute();
    const originals = await h.db.selectFrom('files').selectAll().execute();
    const bytes = originals.map(f => readFileSync(join(h.dataDir, 'files', f.stored_name)));
    const catalog = await h.db.selectFrom('trainings').selectAll().execute();
    const roster = await h.db.selectFrom('employees').selectAll().execute();
    const mappings = await h.db.selectFrom('course_mappings').selectAll().execute();
    const p = await preview();
    expect(p).toMatchObject({ drafts: 1, incompletePages: 2, pages: 3 });
    expect((await reset(p)).json()).toEqual({ removed: 1, resetPages: 3 });
    expect(await h.db.selectFrom('certificates').selectAll().orderBy('id').execute()).toEqual(protectedRows);
    expect(await h.db.selectFrom('files').selectAll().execute()).toEqual(originals);
    originals.forEach((f, i) => { expect(existsSync(join(h.dataDir, 'files', f.stored_name))).toBe(true); expect(readFileSync(join(h.dataDir, 'files', f.stored_name))).toEqual(bytes[i]); });
    expect(await h.db.selectFrom('trainings').selectAll().execute()).toEqual(catalog);
    expect(await h.db.selectFrom('employees').selectAll().execute()).toEqual(roster);
    expect(await h.db.selectFrom('course_mappings').selectAll().execute()).toEqual(mappings);
    expect(await h.db.selectFrom('pages').select(['state', 'review_generation']).where('id', 'in', [queued, failed]).execute()).toEqual([{ state: 'done', review_generation: 1 }, { state: 'done', review_generation: 1 }]);
    expect((await h.send('GET', '/api/processing')).statusCode).toBe(200);
    expect(await h.db.selectFrom('jobs').selectAll().where('page_id', 'in', [queued, failed]).execute()).toEqual([]);
    expect((await h.db.selectFrom('audit_log').selectAll().where('action', '=', 'certificate.reset-drafts').execute()).length).toBe(1);
  });

  it('선택 묶음만 비우고 원본 다시 읽기로 복구하며 오래된 검수 주소는 재사용하지 않는다', async () => {
    const b = await batch(); const other = await batch();
    await page(b); await page(other); await h.drainQueue();
    const old = (await rows()).find(c => c.batchId === b)!;
    const oldInput = await input(old.id);
    expect((await reset(await preview(b))).json()).toEqual({ removed: 1, resetPages: 1 });
    expect(await rows()).toHaveLength(1);
    expect((await h.send('GET', `/api/certificates/${old.id}`)).statusCode).toBe(404);
    expect((await h.send('POST', `/api/batches/${b}/reprocess`)).statusCode).toBe(200);
    expect(await h.drainQueue()).toEqual([]);
    const restored = (await rows()).find(c => c.batchId === b)!;
    expect(restored.id).toBeGreaterThan(old.id);
    expect(restored.personName).toBe('홍길동');
    expect((await h.send('PUT', `/api/certificates/${old.id}`, oldInput)).statusCode).toBe(404);
  });

  it.each(['edit', 'confirm'] as const)('미리보기 후 %s하면 오래된 초기화 확인을 거부한다', async change => {
    const b = await batch(); await page(b); await h.drainQueue();
    const id = (await rows())[0].id;
    const p = await preview();
    const body = await input(id);
    expect((await h.send(change === 'edit' ? 'PUT' : 'POST', `/api/certificates/${id}${change === 'confirm' ? '/confirm' : ''}`, { ...body, provider: '수정 발급기관' })).statusCode).toBe(200);
    expect((await reset(p)).statusCode).toBe(409);
    expect(await rows()).toHaveLength(1);
  });

  it('이미 읽던 OCR 작업은 초기화 결과를 되살리지 않고 새 작업을 덮어쓰지 않는다', async () => {
    const b = await batch(); const pid = await page(b, '');
    const job = (await claimNextJob(h.db))!;
    let resolveOcr!: (value: string) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const ocr = { name: 'slow-test', label: '가상 OCR', fallbackReason: null, recognize: () => { started(); return new Promise<string>(resolve => { resolveOcr = resolve; }); }, close: async () => {} };
    const running = processPage({ db: h.db, dataDir: h.dataDir, ocr }, pid, job.review_generation);
    await entered;
    expect((await reset(await preview())).json()).toEqual({ removed: 0, resetPages: 1 });
    resolveOcr(text); await running;
    expect(await rows()).toEqual([]);
    await h.send('POST', `/api/batches/${b}/reprocess`);
    const newJob = await h.db.selectFrom('jobs').selectAll().where('page_id', '=', pid).executeTakeFirstOrThrow();
    expect(newJob.review_generation).toBe(1);
    await finishJob(h.db, job.id, job);
    expect(await failJob(h.db, job, '늦은 오류')).toBe('cancelled');
    expect(await h.db.selectFrom('jobs').selectAll().where('id', '=', newJob.id).executeTakeFirst()).toEqual(newJob);
    expect(await h.db.selectFrom('pages').select('state').where('id', '=', pid).executeTakeFirst()).toEqual({ state: 'queued' });
    await processPage({ db: h.db, dataDir: h.dataDir, ocr }, pid, 0);
    expect(await rows()).toEqual([]);
  });

  it('같은 페이지의 자동 판독 완료는 범위를 바꾸지 않고 빈 초기화는 안전하게 끝난다', async () => {
    const b = await batch(); await page(b);
    const p = await preview();
    await h.drainQueue();
    expect((await reset(p)).json()).toEqual({ removed: 1, resetPages: 1 });
    expect((await reset(await preview())).json()).toEqual({ removed: 0, resetPages: 0 });
    expect((await h.send('POST', '/api/certificates/reset-drafts', {})).statusCode).toBe(400);
    expect((await h.app.inject({ method: 'GET', url: '/api/certificates/reset-preview' })).statusCode).toBe(401);
  });

  it('서무는 자기 묶음만 초기화하며 다른 사용자의 토큰을 사용할 수 없다', async () => {
    const adminBatch = await batch(); await page(adminBatch);
    await h.send('POST', '/api/users', { loginId: 'clerk', name: '가상서무', role: 'clerk', password: 'Clerk1234!', departmentIds: [] });
    const clerkId = (await h.db.selectFrom('users').select('id').where('login_id', '=', 'clerk').executeTakeFirstOrThrow()).id;
    await h.db.updateTable('users').set({ must_change_password: 0 }).where('id', '=', clerkId).execute();
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
    const headers = { 'x-requested-with': 'fetch', cookie: `ecp_sid=${login.cookies.find(c => c.name === 'ecp_sid')!.value}` };
    const own = (await h.app.inject({ method: 'POST', url: '/api/batches', payload: { year: 2026 }, headers })).json().id;
    await page(own);
    expect((await h.app.inject({ method: 'GET', url: `/api/certificates/reset-preview?batchId=${adminBatch}`, headers })).statusCode).toBe(403);
    const adminToken = await preview();
    expect((await h.app.inject({ method: 'POST', url: '/api/certificates/reset-drafts', payload: { token: adminToken.token }, headers })).statusCode).toBe(409);
    const p = (await h.app.inject({ method: 'GET', url: '/api/certificates/reset-preview', headers })).json();
    expect(p.pages).toBe(1);
    expect((await h.app.inject({ method: 'POST', url: '/api/certificates/reset-drafts', payload: { token: p.token }, headers })).json().resetPages).toBe(1);
    expect(await h.db.selectFrom('pages').select('review_generation').innerJoin('files', 'files.id', 'pages.file_id').where('files.batch_id', '=', adminBatch).executeTakeFirst()).toEqual({ review_generation: 0 });
  });
});
