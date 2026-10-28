import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { BulkExcludePreview, CertificateDetail } from '../../shared/types.ts';
import { verifyChain } from '../../server/src/lib/logChain.ts';
import { createHarness, PDF, type Harness } from './harness.ts';
let h: Harness;
let ids: number[];
let batch: number;
let department: number;
beforeEach(async () => {
  h = await createHarness();
  department = (await h.send('POST', '/api/departments', { name: '가상부서' })).json().id;
  await h.send('POST', '/api/employees', { name: '홍길동', departmentId: department });
  batch = (await h.send('POST', '/api/batches', { year: 2026, title: '선택 제외 검증' })).json().id;
  for (let n = 1; n <= 4; n++) {
    const file = (await h.uploadFile(batch, Buffer.concat([PDF, Buffer.from(String(n))]), `가상자료${n}.pdf`)).json().fileId;
    await h.uploadPage(file, 1, `수 료 증\n성명: 홍길동\n소속: 가상부서\n과정명: 공직자 청렴교육\n교육기간: 2026.04.0${n}.~2026.04.0${n}.\n교육시간: 2시간\n제 FAKE-BULK-00${n} 호\n위 사람은 교육과정을 이수하였기에 이 증서를 수여합니다.\n가상연수원장`);
  }
  expect(await h.drainQueue()).toEqual([]);
  ids = (await h.db.selectFrom('certificates').select('id').orderBy('id').execute()).map(r => r.id);
  const d = (await h.send('GET', `/api/certificates/${ids[1]}`)).json() as CertificateDetail;
  expect((await h.send('POST', `/api/certificates/${d.id}/confirm`, { employeeId: d.employee!.id, credits: d.credits, completedOn: d.completedOn, hours: d.hours, courseTitle: d.courseTitle, provider: d.provider, certNo: d.certNo, year: d.year })).statusCode).toBe(200);
  await h.send('POST', `/api/certificates/${ids[2]}/exclude`, { reason: '기존 제외' });
});
afterEach(async () => { await h.close(); });
async function preview(selected = [ids[0], ids[1]]) {
  const response = await h.send('POST', '/api/certificates/bulk-exclude-preview', { ids: selected });
  expect(response.statusCode).toBe(200);
  return response.json() as BulkExcludePreview;
}
async function apply(p: BulkExcludePreview, reason = '중복 제출') {
  return h.send('POST', '/api/certificates/bulk-exclude', { ids: p.ids, token: p.token, reason });
}
async function rows() { return h.db.selectFrom('certificates').selectAll().orderBy('id').execute(); }

it('검색에 쓸 원본 과정명을 목록에도 제공한다', async () => {
  const list = (await h.send('GET', '/api/certificates')).json();
  expect(list).toHaveLength(4);
  expect(list.every((c: { courseTitle: string }) => c.courseTitle === '공직자 청렴교육')).toBe(true);
});
it('선택한 대기·확정 자료만 함께 제외하고 원본·인정 연결·다른 기록·과거 확정 정보를 보존한다', async () => {
  const before = await rows();
  const credits = await h.db.selectFrom('certificate_trainings').selectAll().execute();
  const files = await h.db.selectFrom('files').selectAll().execute();
  const bytes = files.map(f => readFileSync(join(h.dataDir, 'files', f.stored_name)));
  const pages = await h.db.selectFrom('pages').selectAll().execute();
  const mappings = await h.db.selectFrom('course_mappings').selectAll().execute();
  const p = await preview([ids[1], ids[0], ids[0]]);
  expect(p.ids).toEqual(ids.slice(0, 2));
  expect(p).toMatchObject({ drafts: 1, confirmed: 1 });
  expect(p.items.map(i => i.fileName)).toEqual(['가상자료1.pdf', '가상자료2.pdf']);
  const response = await apply(p, '  중복 제출  ');
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ excluded: 2, ids: ids.slice(0, 2) });
  const after = await rows();
  for (let i = 0; i < after.length; i++) {
    if (i < 2) expect(after[i]).toEqual({ ...before[i], status: 'excluded', exclude_reason: '중복 제출', updated_at: after[i].updated_at });
    else expect(after[i]).toEqual(before[i]);
  }
  expect(await h.db.selectFrom('certificate_trainings').selectAll().execute()).toEqual(credits);
  expect(await h.db.selectFrom('pages').selectAll().execute()).toEqual(pages);
  expect(await h.db.selectFrom('files').selectAll().execute()).toEqual(files);
  files.forEach((f, i) => expect(readFileSync(join(h.dataDir, 'files', f.stored_name))).toEqual(bytes[i]));
  expect(await h.db.selectFrom('course_mappings').selectAll().execute()).toEqual(mappings);
  const audit = await h.db.selectFrom('audit_log').select(['action', 'target_id', 'detail']).where('action', '=', 'certificate.bulk-exclude').executeTakeFirstOrThrow();
  expect(JSON.parse(audit.detail!)).toEqual({ reason: '중복 제출', ids: ids.slice(0, 2), excluded: 2 });
  for (const id of ids.slice(0, 2)) expect(await h.db.selectFrom('audit_log').select('id').where('action', '=', 'certificate.exclude').where('target_id', '=', String(id)).executeTakeFirst()).toBeDefined();
  expect((await verifyChain(h.db, 'audit_log')).ok).toBe(true);
  expect((await h.send('GET', '/api/status?year=2026')).json().rows[0].cells[credits[0].training_id].count).toBe(0);
  expect((await h.send('POST', `/api/certificates/${ids[0]}/reopen`)).json().status).toBe('draft');
});
it('다른 선택을 끼우거나 이미 제외한 자료·읽는 중 자료가 있으면 일부도 처리하지 않는다', async () => {
  const p = await preview();
  const before = await rows();
  expect((await h.send('POST', '/api/certificates/bulk-exclude', { ...p, ids: [ids[0], ids[3]], reason: '중복 제출' })).statusCode).toBe(409);
  expect((await h.send('POST', '/api/certificates/bulk-exclude-preview', { ids: [ids[0], ids[2]] })).statusCode).toBe(409);
  expect((await h.send('POST', '/api/certificates/bulk-exclude-preview', { ids: [ids[0], 999999] })).statusCode).toBe(404);
  const selected = before.find(c => c.id === ids[1])!;
  await h.db.updateTable('pages').set({ state: 'processing' }).where('id', '=', selected.page_id).execute();
  expect((await apply(p)).statusCode).toBe(409);
  expect(await rows()).toEqual(before);
});
it('확인창 이후 수동 수정이나 인정시간 변경이 있으면 새 확인을 요구한다', async () => {
  const p = await preview();
  // 같은 밀리초에 저장되어 updated_at이 같더라도 실제 필드와 연결을 함께 비교한다.
  await h.db.updateTable('certificates').set({ course_title: '수정한 과정' }).where('id', '=', ids[0]).execute();
  const modified = await rows();
  expect((await apply(p)).statusCode).toBe(409);
  expect(await rows()).toEqual(modified);
  const next = await preview();
  await h.db.updateTable('certificate_trainings').set({ credited_hours: 1 }).where('certificate_id', '=', ids[0]).execute();
  expect((await apply(next)).statusCode).toBe(409);
  expect((await rows()).every(c => c.status !== 'excluded' || c.id === ids[2])).toBe(true);
});
it('빈 사유·빈 선택·500건 초과·미인증 요청을 거부한다', async () => {
  const p = await preview();
  const before = await rows();
  expect((await apply(p, '   ')).statusCode).toBe(400);
  expect((await h.send('POST', '/api/certificates/bulk-exclude-preview', { ids: [] })).statusCode).toBe(400);
  expect((await h.send('POST', '/api/certificates/bulk-exclude-preview', { ids: Array.from({ length: 501 }, () => ids[0]) })).statusCode).toBe(400);
  expect((await h.app.inject({ method: 'POST', url: '/api/certificates/bulk-exclude-preview', payload: { ids: [ids[0]] }, headers: { 'x-requested-with': 'fetch' } })).statusCode).toBe(401);
  expect(await rows()).toEqual(before);
});
it('대기 자료가 확인창 이후 확정되면 이전 확인으로 제외하지 않는다', async () => {
  const p = await preview();
  const d = (await h.send('GET', `/api/certificates/${ids[0]}`)).json() as CertificateDetail;
  expect((await h.send('POST', `/api/certificates/${d.id}/confirm`, { employeeId: d.employee!.id, credits: d.credits, completedOn: d.completedOn, hours: d.hours, courseTitle: d.courseTitle, provider: d.provider, certNo: d.certNo, year: d.year })).statusCode).toBe(200);
  const confirmed = await rows();
  expect((await apply(p)).statusCode).toBe(409);
  expect(await rows()).toEqual(confirmed);
});
it('서무의 권한 밖 자료가 섞이면 전체 거부하고 다른 사용자의 확인 토큰도 쓸 수 없다', async () => {
  const other = (await h.send('POST', '/api/departments', { name: '다른부서' })).json().id;
  await h.send('POST', '/api/users', { loginId: 'clerk', name: '가상서무', role: 'clerk', password: 'Clerk1234!', departmentIds: [other] });
  const clerk = await h.db.selectFrom('users').select('id').where('login_id', '=', 'clerk').executeTakeFirstOrThrow();
  await h.db.updateTable('users').set({ must_change_password: 0 }).where('id', '=', clerk.id).execute();
  const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
  const headers = { 'x-requested-with': 'fetch', cookie: `ecp_sid=${login.cookies.find(c => c.name === 'ecp_sid')!.value}` };
  const p = await preview(); const before = await rows();
  expect((await h.app.inject({ method: 'POST', url: '/api/certificates/bulk-exclude-preview', payload: { ids: p.ids }, headers })).statusCode).toBe(403);
  expect((await h.app.inject({ method: 'POST', url: '/api/certificates/bulk-exclude', payload: { ids: p.ids, token: p.token, reason: '중복 제출' }, headers })).statusCode).toBe(403);
  // 같은 자료를 볼 권한을 갖게 되어도 관리자용 확인 토큰을 재사용하지 못한다.
  await h.db.insertInto('user_departments').values({ user_id: clerk.id, department_id: department }).execute();
  expect((await h.app.inject({ method: 'POST', url: '/api/certificates/bulk-exclude', payload: { ids: p.ids, token: p.token, reason: '중복 제출' }, headers })).statusCode).toBe(409);
  expect(await rows()).toEqual(before);
});
