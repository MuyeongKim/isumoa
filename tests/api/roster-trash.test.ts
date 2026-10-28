import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMatchables } from '../../server/src/certs/review.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let department: number;
let first: number;
let second: number;
beforeAll(async () => {
  h = await createHarness();
  department = (await h.send('POST', '/api/departments', { name: '검증부서' })).json().id;
  first = (await h.send('POST', '/api/employees', { name: '가직원', departmentId: department, empNo: '1001' })).json().id;
  second = (await h.send('POST', '/api/employees', { name: '나직원', departmentId: department, empNo: '1002' })).json().id;
  const batch = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const file = (await h.uploadFile(batch, PDF, '증빙.pdf')).json().fileId;
  await h.uploadPage(file, 1, '수료증\n성명: 가직원\n소속: 검증부서\n과정명: 공직자 청렴교육\n교육시간: 2시간\n이수일자: 2026. 5. 20.');
  await h.drainQueue();
  const drafts = (await h.send('GET', '/api/certificates?status=draft')).json();
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: drafts.map((d: { id: number }) => d.id) })).json().confirmed).toBe(1);
});
afterAll(async () => { await h.close(); });

describe('명단 휴지통', () => {
  it('직원 선택 삭제는 증빙을 보존하고 현황·매칭에서 제외한다', async () => {
    const response = await h.send('POST', '/api/employees/bulk-delete', { ids: [first, first] });
    expect(response.json()).toEqual({ changed: 1 });
    expect((await h.send('GET', '/api/employees')).json().map((e: { id: number }) => e.id)).toEqual([second]);
    expect((await h.send('GET', '/api/employees?trash=1')).json().map((e: { id: number }) => e.id)).toEqual([first]);
    expect((await loadMatchables(h.db)).map(e => e.id)).toEqual([second]);
    expect((await h.send('GET', '/api/exports/summary?year=2026')).json().certificates).toBe(0);
    expect(await h.db.selectFrom('certificates').selectAll().execute()).toHaveLength(1);
    const restore = await h.send('POST', '/api/employees/bulk-restore', { ids: [first] });
    expect(restore.statusCode).toBe(200);
    expect((await h.send('GET', '/api/exports/summary?year=2026')).json().certificates).toBe(1);
  });

  it('선택한 항목 중 하나가 없으면 아무것도 삭제하지 않는다', async () => {
    expect((await h.send('POST', '/api/employees/bulk-delete', { ids: [first, 99999] })).statusCode).toBe(409);
    expect((await h.send('GET', '/api/employees')).json()).toHaveLength(2);
  });

  it('부서 복원은 함께 삭제한 직원만 복원한다', async () => {
    await h.send('POST', '/api/employees/bulk-delete', { ids: [first] });
    const remove = await h.send('POST', '/api/departments/bulk-delete', { ids: [department] });
    expect(remove.json()).toEqual({ changed: 1, employees: 1 });
    expect((await h.send('GET', '/api/departments')).json()).toHaveLength(0);
    expect((await h.send('GET', '/api/employees')).json()).toHaveLength(0);
    expect((await h.send('POST', '/api/employees/bulk-restore', { ids: [second] })).statusCode).toBe(409);
    expect((await h.send('POST', '/api/employees', { name: '새직원', departmentId: department })).statusCode).toBe(400);
    const restored = await h.send('POST', '/api/departments/bulk-restore', { ids: [department] });
    expect(restored.json()).toEqual({ changed: 1, employees: 1 });
    expect((await h.send('GET', '/api/employees')).json().map((e: { id: number }) => e.id)).toEqual([second]);
    await h.send('POST', '/api/employees/bulk-restore', { ids: [first] });
    expect((await h.send('GET', '/api/exports/summary?year=2026')).json().certificates).toBe(1);
  });

  it('서무는 삭제·복원·휴지통을 사용할 수 없다', async () => {
    const created = await h.send('POST', '/api/users', { loginId: 'clerk2', name: '검증서무', role: 'clerk', departmentIds: [department], password: 'Clerk1234!' });
    await h.db.updateTable('users').set({ must_change_password: 0 }).where('id', '=', created.json().id).execute();
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk2', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
    const cookie = `ecp_sid=${login.cookies[0].value}`;
    for (const url of ['/api/employees/bulk-delete', '/api/departments/bulk-delete', '/api/employees/bulk-restore']) {
      expect((await h.app.inject({ method: 'POST', url, payload: { ids: [first] }, headers: { cookie, 'x-requested-with': 'fetch' } })).statusCode).toBe(403);
    }
    expect((await h.app.inject({ method: 'GET', url: '/api/employees?trash=1', headers: { cookie } })).statusCode).toBe(403);
  });
});
