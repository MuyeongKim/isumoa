import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifiable, loadLearned, loadTrainings } from '../../server/src/certs/review.ts';
import { classifyTrainings } from '../../server/src/certs/trainingClassifier.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let departmentId: number;
let certificateId: number;
let trainingIds: number[];

beforeAll(async () => {
  h = await createHarness();
  departmentId = (await h.send('POST', '/api/departments', { name: '검증부서' })).json().id;
  await h.send('POST', '/api/employees', { name: '가직원', departmentId, empNo: '1001' });
  const batch = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const file = (await h.uploadFile(batch, PDF, '교육증빙.pdf')).json().fileId;
  await h.uploadPage(file, 1, '수료증\n성명: 가직원\n소속: 검증부서\n과정명: 2026년 4대폭력 예방 통합교육\n교육시간: 4시간\n이수일자: 2026. 5. 20.');
  await h.drainQueue();
  const draft = (await h.send('GET', '/api/certificates?status=draft')).json()[0];
  certificateId = draft.id;
  trainingIds = draft.trainingIds;
  expect(trainingIds).toHaveLength(4);
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [certificateId] })).json().confirmed).toBe(1);
});

afterAll(async () => { await h.close(); });

describe('교육 과정 삭제·복원', () => {
  it('선택 삭제는 이수증·인정 내역을 보존하고 현황·자동 분류·내보내기에서 제외한다', async () => {
    const certificate = await h.db.selectFrom('certificates').selectAll().where('id', '=', certificateId).executeTakeFirstOrThrow();
    const credits = await h.db.selectFrom('certificate_trainings').selectAll().where('certificate_id', '=', certificateId).execute();
    const before = (await h.send('GET', '/api/overview')).json().activeTrainings;
    expect((await h.send('POST', '/api/trainings/bulk-delete', { ids: [...trainingIds, trainingIds[0]] })).json()).toEqual({ changed: 4 });
    expect((await h.send('GET', '/api/trainings')).json().some((t: { id: number }) => trainingIds.includes(t.id))).toBe(false);
    expect((await h.send('GET', '/api/trainings?trash=1')).json()).toHaveLength(4);
    expect((await h.send('GET', '/api/overview')).json().activeTrainings).toBe(before - 4);
    expect((await h.send('GET', '/api/exports/summary?year=2026')).json().certificates).toBe(0);
    expect((await h.send('GET', '/api/dashboard?year=2026')).json().trainings.some((t: { id: number }) => trainingIds.includes(t.id))).toBe(false);
    expect(classifyTrainings('2026년 4대폭력 예방 통합교육', '', classifiable(await loadTrainings(h.db), 2026), await loadLearned(h.db)).trainingIds).toEqual([]);
    expect(await h.db.selectFrom('certificates').selectAll().where('id', '=', certificateId).executeTakeFirst()).toEqual(certificate);
    expect(await h.db.selectFrom('certificate_trainings').selectAll().where('certificate_id', '=', certificateId).execute()).toEqual(credits);

    expect((await h.send('POST', '/api/trainings/bulk-restore', { ids: trainingIds })).json()).toEqual({ changed: 4 });
    expect((await h.send('GET', '/api/trainings?trash=1')).json()).toHaveLength(0);
    expect((await h.send('GET', '/api/exports/summary?year=2026')).json().certificates).toBe(1);
    expect((await h.send('GET', '/api/overview')).json().activeTrainings).toBe(before);
  });

  it('없는 항목이 함께 선택되면 일부만 삭제하지 않는다', async () => {
    expect((await h.send('POST', '/api/trainings/bulk-delete', { ids: [trainingIds[0], 99999] })).statusCode).toBe(409);
    expect((await h.send('GET', '/api/trainings?trash=1')).json()).toHaveLength(0);
  });

  it('개별 삭제 후 중복 생성·수정을 막고, 원래 사용 상태로 복원한다', async () => {
    const id = (await h.send('POST', '/api/trainings', { name: '휴지통 검증교육', reqType: 'count', reqValue: 1, active: false })).json().id;
    expect((await h.app.inject({ method: 'DELETE', url: `/api/trainings/${id}`, headers: { 'x-requested-with': 'fetch', cookie: '' } })).statusCode).toBe(401);
    expect((await h.send('DELETE', `/api/trainings/${id}`)).statusCode).toBe(200);
    expect((await h.send('PATCH', `/api/trainings/${id}`, { name: '삭제한 교육 수정' })).statusCode).toBe(404);
    const duplicate = await h.send('POST', '/api/trainings', { name: '휴지통 검증교육', reqType: 'count', reqValue: 1 });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.message).toContain('휴지통');
    const imported = await h.send('POST', '/api/trainings/import/apply', { fileName: '교육계획.hwpx', trainings: [{ name: '휴지통 검증교육', reqType: 'count', reqValue: 1 }] });
    expect(imported.statusCode).toBe(409);
    expect(imported.json().error.message).toContain('복원');
    await h.send('POST', '/api/trainings/bulk-restore', { ids: [id] });
    expect((await h.send('GET', '/api/trainings')).json().find((t: { id: number }) => t.id === id)).toMatchObject({ active: false, deletedAt: null });
  });

  it('삭제된 교육이 섞인 검수 대기는 일괄 확정할 수 없고 복원하면 다시 확정된다', async () => {
    expect((await h.send('POST', `/api/certificates/${certificateId}/reopen`)).statusCode).toBe(200);
    await h.send('POST', '/api/trainings/bulk-delete', { ids: [trainingIds[0]] });
    const blocked = await h.send('POST', '/api/certificates/bulk-confirm', { ids: [certificateId] });
    expect(blocked.json().confirmed).toBe(0);
    expect(blocked.json().skipped[0].reason).toContain('삭제된 교육');
    await h.send('POST', '/api/trainings/bulk-restore', { ids: [trainingIds[0]] });
    expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [certificateId] })).json().confirmed).toBe(1);
  });

  it('서무는 삭제·복원·휴지통을 사용할 수 없다', async () => {
    const created = await h.send('POST', '/api/users', { loginId: 'training-clerk', name: '검증서무', role: 'clerk', departmentIds: [departmentId], password: 'Clerk1234!' });
    await h.db.updateTable('users').set({ must_change_password: 0 }).where('id', '=', created.json().id).execute();
    const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'training-clerk', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
    const cookie = `ecp_sid=${login.cookies[0].value}`;
    for (const url of ['/api/trainings/bulk-delete', '/api/trainings/bulk-restore']) {
      expect((await h.app.inject({ method: 'POST', url, payload: { ids: [trainingIds[0]] }, headers: { cookie, 'x-requested-with': 'fetch' } })).statusCode).toBe(403);
    }
    expect((await h.app.inject({ method: 'GET', url: '/api/trainings?trash=1', headers: { cookie } })).statusCode).toBe(403);
  });
});
