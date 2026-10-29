import { afterEach, beforeEach, expect, it } from 'vitest';
import type { CertificateDetail, CertificateInput, CertificateListItem } from '../../shared/types.ts';
import { UNIEDU_PUBLIC_COURSES, UNIEDU_SCHEDULED_COURSES } from '../../shared/unieduCatalog.ts';
import { processPage } from '../../server/src/certs/processPage.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let batchId: number;
let unification: number;
let security: number;
let sequence: number;
beforeEach(async () => {
  h = await createHarness(); sequence = 0;
  unification = (await h.send('POST', '/api/trainings', { name: '통일의식 교육', reqType: 'hours', reqValue: 1, keywords: ['통일'] })).json().id;
  security = (await h.send('POST', '/api/trainings', { name: '공직자안보교육', reqType: 'hours', reqValue: 1, keywords: ['안보'] })).json().id;
  const departmentId = (await h.send('POST', '/api/departments', { name: '가상검증부서' })).json().id;
  expect((await h.send('POST', '/api/employees', { name: '홍길동', departmentId, birthDate: '1980-01-01' })).statusCode).toBe(200);
  batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
});
afterEach(async () => { await h.close(); });

async function upload(title: string, options: { provider?: string | null; hours?: string; year?: number; extra?: string; heading?: string } = {}) {
  const n = ++sequence;
  const provider = options.provider === undefined ? '국립통일교육원' : options.provider;
  const text = [options.heading ?? '이수증', '성명 : 홍길동', '생년월일 : 1980-01-01', '소속 : 가상검증부서', `과정명 : ${title}`, `이수일 : ${options.year ?? 2026}-10-20`,
    `교육시간 : ${options.hours ?? '1시간'}`, ...(provider ? [`교육기관 : ${provider}`] : []), `증서번호 : UNIEDU-FAKE-${n}`, options.extra ?? ''].join('\n');
  const fileName = `가상통일수료증${n}.pdf`;
  const f = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from(String(n))]), fileName)).json().fileId;
  const pageId = await h.uploadPage(f, 1, text);
  expect(await h.drainQueue()).toEqual([]);
  const c = ((await h.send('GET', '/api/certificates')).json() as CertificateListItem[]).find(c => c.fileName === fileName)!;
  return { detail: (await h.send('GET', `/api/certificates/${c.id}`)).json() as CertificateDetail, pageId };
}
const input = (c: CertificateDetail, target = unification): CertificateInput => ({
  employeeId: c.employee!.id, credits: [{ trainingId: target, creditedHours: c.hours }], completedOn: c.completedOn,
  hours: c.hours, courseTitle: c.courseTitle, provider: c.provider, certNo: c.certNo, year: c.year,
});
async function snapshot(id: number) {
  return { certificate: await h.db.selectFrom('certificates').selectAll().where('id', '=', id).executeTakeFirst(),
    credits: await h.db.selectFrom('certificate_trainings').selectAll().where('certificate_id', '=', id).execute(),
    mappings: await h.db.selectFrom('course_mappings').selectAll().execute() };
}

it('공식 47개 과정 모두 업로드·판독·직원 연결을 거쳐 통일교육으로만 제안한다', async () => {
  for (const course of UNIEDU_PUBLIC_COURSES) {
    const { detail: c } = await upload(course.title, { hours: `${course.recognizedHours}시간` });
    expect(c.trainingIds, course.title).toEqual([unification]);
    expect(c.hours).toBe(course.recognizedHours);
    expect(c.flags.some(f => f.code === 'training-catalog-match')).toBe(true);
    expect(c.flags.some(f => f.level === 'error')).toBe(false);
  }
});
it('실제 확정으로 저장한 과정명 연결을 다른 기관이나 기관 미판독 자료에 확대하지 않고 확정 기록도 보존한다', async () => {
  const { detail: first, pageId } = await upload('헌법으로 본 통일');
  expect((await h.send('POST', `/api/certificates/${first.id}/confirm`, input(first))).statusCode).toBe(200);
  const before = await snapshot(first.id);
  for (const provider of ['민간교육센터', null]) {
    const { detail: next } = await upload('헌법으로 본 통일', { provider });
    expect(next.trainingIds).toEqual([]);
    expect(next.flags.some(f => f.code === 'training-catalog-check')).toBe(true);
  }
  await processPage({ db: h.db, dataDir: h.dataDir, ocr: h.ocr }, pageId);
  expect(await snapshot(first.id)).toEqual(before);
});
it('안보 오연결은 저장 후 개별·일괄 확정을 막고 통일교육으로 고치면 확정한다', async () => {
  const { detail: c } = await upload('북핵 문제와 동북아 안보 상황', { hours: '2시간' });
  const wrong = input(c, security);
  const saved = await h.send('PUT', `/api/certificates/${c.id}`, wrong);
  expect(saved.json().flags.find((f: { code: string }) => f.code === 'training-scope-conflict')).toMatchObject({ level: 'error' });
  const before = await snapshot(c.id);
  expect((await h.send('POST', `/api/certificates/${c.id}/confirm`, wrong)).statusCode).toBe(422);
  expect(await snapshot(c.id)).toEqual(before);
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [c.id] })).json()).toMatchObject({ confirmed: 0 });
  // 원본에 발급기관이 있으면 기관명을 비워 충돌 검사를 우회할 수 없다.
  expect((await h.send('POST', `/api/certificates/${c.id}/confirm`, { ...wrong, provider: null })).statusCode).toBe(422);
  const correct = await h.send('POST', `/api/certificates/${c.id}/confirm`, input(c));
  expect(correct.statusCode).toBe(200);
  expect(correct.json()).toMatchObject({ status: 'confirmed', trainingIds: [unification] });
});
it('목록과 다른 수료시간을 덮어쓰지 않고 경고하며 수정 후에는 경고가 해소된다', async () => {
  const { detail: c } = await upload('우주에서 본 북한', { hours: '0.5시간' });
  expect(c.hours).toBe(0.5);
  expect(c.credits[0].creditedHours).toBe(0.5);
  expect(c.flags.find(f => f.code === 'training-catalog-check')?.message).toContain('공식 과정표(1시간)');
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [c.id] })).json()).toMatchObject({ confirmed: 0 });
  const result = await h.send('POST', `/api/certificates/${c.id}/confirm`, { ...input(c), hours: 1, credits: [{ trainingId: unification, creditedHours: 1 }] });
  expect(result.statusCode).toBe(200);
  expect(result.json().flags.some((f: { code: string }) => f.code === 'training-catalog-check')).toBe(false);
});
it('차시만 읽으면 시간을 채우지 않고, 인정시간이 병기된 경우 실제 시간을 읽는다', async () => {
  const { detail: sessions } = await upload('북한 인사이드 : 북한 사회와 주민 이해Ⅰ', { hours: '3차시' });
  expect(sessions.trainingIds).toEqual([unification]);
  expect(sessions.hours).toBeNull();
  expect(sessions.flags.some(f => f.code === 'hours-sessions')).toBe(true);
  const { detail: hours } = await upload('북한 인사이드 : 북한 사회와 주민 이해Ⅱ', { hours: '4차시 (8시간)' });
  expect(hours.hours).toBe(8);
  expect(hours.flags.some(f => f.code === 'training-catalog-check')).toBe(false);
});
it('개설 예정 과정과 마이크로러닝은 통일이라는 단어가 있어도 공식 연결하지 않는다', async () => {
  const { detail: planned } = await upload(UNIEDU_SCHEDULED_COURSES[0], { hours: '2시간' });
  expect(planned.trainingIds).toEqual([]);
  expect(planned.flags.find(f => f.code === 'training-catalog-check')?.message).toContain('개설 예정');
  const { detail: micro } = await upload('헌법으로 본 통일', { extra: '마이크로러닝 · 이수증 미발급' });
  expect(micro.trainingIds).toEqual([]);
});
it('공식 과정 목록이 적힌 안내문을 수료증으로 등록하지 않는다', async () => {
  const { detail: c } = await upload('우주에서 본 북한', { heading: '교육과정 안내', provider: null });
  expect(c.trainingIds).toEqual([]);
  expect(c.flags.some(f => f.code === 'not-certificate')).toBe(true);
});
