import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CertificateDetail, CertificateInput, CertificateListItem } from '../../shared/types.ts';
import { courseTitleKey } from '../../server/src/certs/trainingClassifier.ts';
import { additionalCertificateSamples, managedTrainingSamples } from '../fixtures-certificates.ts';
import { createHarness, PDF, type Harness } from './harness.ts';
let h: Harness;
let b: number;
let sequence: number;
const security = additionalCertificateSamples.find(s => s.file === 'report (16).pdf')!;
const traffic = additionalCertificateSamples.find(s => s.file === 'report (12).pdf')!;
beforeEach(async () => {
  h = await createHarness(); sequence = 0;
  await h.db.deleteFrom('trainings').execute();
  for (const t of managedTrainingSamples) await h.send('POST', '/api/trainings', t);
  const departmentId = (await h.send('POST', '/api/departments', { name: '119구조대' })).json().id;
  await h.send('POST', '/api/employees', { name: '홍길동', departmentId });
  b = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
});
afterEach(async () => { await h.close(); });
async function trainingId(name: string) {
  return (await h.db.selectFrom('trainings').select('id').where('name', '=', name).executeTakeFirstOrThrow()).id;
}
async function upload(sample = security) {
  const n = ++sequence;
  const f = (await h.uploadFile(b, Buffer.concat([PDF, Buffer.from(String(n))]), `가상주제${n}.pdf`)).json().fileId;
  await h.uploadPage(f, 1, sample.text.replaceAll(sample.expected.certNo!, `FAKE-TOPIC-${n}`));
  expect(await h.drainQueue()).toEqual([]);
  const c = ((await h.send('GET', '/api/certificates')).json() as CertificateListItem[]).find(c => c.fileName === `가상주제${n}.pdf`)!;
  return (await h.send('GET', `/api/certificates/${c.id}`)).json() as CertificateDetail;
}
function input(c: CertificateDetail, target: number): CertificateInput {
  return { employeeId: c.employee!.id, credits: [{ trainingId: target, creditedHours: c.hours }], completedOn: c.completedOn,
    hours: c.hours, courseTitle: c.courseTitle, provider: c.provider, certNo: c.certNo, year: c.year };
}
async function snapshot(id: number) {
  return { certificate: await h.db.selectFrom('certificates').selectAll().where('id', '=', id).executeTakeFirst(),
    credits: await h.db.selectFrom('certificate_trainings').selectAll().where('certificate_id', '=', id).execute(),
    mappings: await h.db.selectFrom('course_mappings').selectAll().execute() };
}

it.each([
  { sample: security, wrong: '정보공개교육' }, { sample: traffic, wrong: '긴급복지신고의무자교육' },
])('$wrong에 잘못 연결하면 저장은 허용하고 관리자 개별·일괄 확정을 차단한다', async ({ sample, wrong }) => {
  const c = await upload(sample);
  const body = input(c, await trainingId(wrong));
  const saved = await h.send('PUT', `/api/certificates/${c.id}`, body);
  expect(saved.statusCode).toBe(200);
  expect(saved.json().flags.find((f: { code: string }) => f.code === 'training-scope-conflict')).toMatchObject({ level: 'error' });
  const before = await snapshot(c.id);
  const confirmed = await h.send('POST', `/api/certificates/${c.id}/confirm`, body);
  expect(confirmed.statusCode).toBe(422);
  expect(confirmed.json().error).toMatchObject({ code: 'BLOCKING_FLAGS', message: expect.stringContaining('주제 충돌') });
  expect(await snapshot(c.id)).toEqual(before);
  // 예전 화면에서 저장한 경고나 빈 flags를 보내도 서버가 현재 값으로 다시 판정한다.
  await h.db.updateTable('certificates').set({ flags: '[]' }).where('id', '=', c.id).execute();
  const bulk = (await h.send('POST', '/api/certificates/bulk-confirm', { ids: [c.id] })).json();
  expect(bulk.confirmed).toBe(0);
  expect(bulk.skipped).toEqual([{ id: c.id, reason: expect.stringContaining('주제 충돌') }]);
  expect((await h.db.selectFrom('certificates').select('status').where('id', '=', c.id).executeTakeFirst())?.status).toBe('draft');
  expect(await h.db.selectFrom('course_mappings').selectAll().execute()).toEqual([]);
});

it.each([null, '   '])('과정명을 %j로 비우거나 저장 없이 직접 요청해도 원본 주제로 차단하고 변경을 되돌린다', async blank => {
  const c = await upload();
  const body = { ...input(c, await trainingId('정보공개교육')), courseTitle: blank };
  const before = await snapshot(c.id);
  const confirmed = await h.send('POST', `/api/certificates/${c.id}/confirm`, body);
  expect(confirmed.statusCode).toBe(422);
  expect(confirmed.json().error.message).toContain('주제 충돌');
  expect(await snapshot(c.id)).toEqual(before);
});

it('인정할 교육을 원본에 맞게 고치면 충돌 오류가 해소되어 확정된다', async () => {
  const c = await upload();
  const body = input(c, await trainingId('정보공개교육'));
  await h.send('PUT', `/api/certificates/${c.id}`, body);
  const correct = (await h.send('POST', '/api/trainings', { name: '정보보안교육', reqType: 'hours', reqValue: 1, keywords: ['정보보안'] })).json().id;
  const result = await h.send('POST', `/api/certificates/${c.id}/confirm`, { ...body, credits: [{ trainingId: correct, creditedHours: c.hours }] });
  expect(result.statusCode).toBe(200);
  expect(result.json().status).toBe('confirmed');
  expect(result.json().trainingIds).toEqual([correct]);
  expect(result.json().flags.some((f: { code: string }) => f.code === 'training-scope-conflict')).toBe(false);
});

it('잘못 읽힌 과정명을 바로잡은 경우에도 현재 주제를 다시 검사해 확정을 허용한다', async () => {
  const c = await upload();
  const body = input(c, await trainingId('정보공개교육'));
  await h.send('PUT', `/api/certificates/${c.id}`, body);
  const result = await h.send('POST', `/api/certificates/${c.id}/confirm`, { ...body, courseTitle: '정보공개제도 교육' });
  expect(result.statusCode).toBe(200);
  expect(result.json().status).toBe('confirmed');
  expect(result.json().flags.some((f: { code: string }) => f.code === 'training-scope-conflict')).toBe(false);
});

it('과거 확정 기록은 보존하면서 잘못 학습한 연결을 새 수료증에 재사용하지 않는다', async () => {
  const c = await upload();
  const wrong = await trainingId('정보공개교육');
  await h.send('PUT', `/api/certificates/${c.id}`, input(c, wrong));
  // 차단 규칙 도입 전 확정되어 있던 이력과 매핑을 재현한다.
  await h.db.updateTable('certificates').set({ status: 'confirmed', flags: JSON.stringify([{ code: 'training-scope-conflict', level: 'warning', message: '이전 경고' }]) }).where('id', '=', c.id).execute();
  await h.db.insertInto('course_mappings').values({ title_key: courseTitleKey(c.courseTitle!), training_id: wrong }).execute();
  const before = await snapshot(c.id);
  const next = await upload();
  expect(next.trainingIds).toEqual([]);
  expect(next.flags.map(f => f.code)).toEqual(expect.arrayContaining(['no-training', 'training-scope-conflict']));
  expect(await snapshot(c.id)).toEqual(before);
});

it('주제 충돌과 다른 일반 후보 경고는 기존처럼 사람이 확인해 개별 확정할 수 있다', async () => {
  const sample = additionalCertificateSamples.find(s => s.file === 'report (17).pdf')!;
  const c = await upload(sample);
  expect(c.flags.map(f => f.code)).toContain('training-name-suggestion');
  const result = await h.send('POST', `/api/certificates/${c.id}/confirm`, input(c, await trainingId('자살예방교육')));
  expect(result.statusCode).toBe(200);
  expect(result.json().status).toBe('confirmed');
});
