import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CertificateDetail, CertificateInput, CertificateListItem } from '../../shared/types.ts';
import { additionalCertificateSamples, managedTrainingSamples, narabaeumSamples, type CertificateSample } from '../fixtures-certificates.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let sequence = 0;
let current: CertificateListItem[];
let protectedCertificates: unknown[];

async function putSample(sample: CertificateSample, fileName = sample.file, text = sample.text) {
  const batch = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const file = (await h.uploadFile(batch, Buffer.concat([PDF, Buffer.from(`unique-bytes-${sequence++}`)]), fileName)).json().fileId;
  await h.uploadPage(file, 1, text);
}

beforeAll(async () => {
  h = await createHarness();
  await h.db.deleteFrom('trainings').execute();
  for (const training of managedTrainingSamples) await h.send('POST', '/api/trainings', training);
  const department = (await h.send('POST', '/api/departments', { name: '119구조대' })).json().id;
  await h.send('POST', '/api/employees', { name: '홍길동', departmentId: department });
  for (const sample of narabaeumSamples) await putSample(sample);
  expect(await h.drainQueue()).toEqual([]);
  const old = (await h.send('GET', '/api/certificates?status=draft')).json() as CertificateListItem[];
  const approved = old.filter(d => ['report.pdf', 'report (3).pdf'].includes(d.fileName)).map(d => d.id);
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: approved })).json().confirmed).toBe(2);
  protectedCertificates = await h.db.selectFrom('certificates').selectAll().where('id', 'in', approved).orderBy('id').execute();
  for (const sample of additionalCertificateSamples) await putSample(sample);
  expect(await h.drainQueue()).toEqual([]);
  current = (await h.send('GET', '/api/certificates?status=draft')).json();
});

afterAll(async () => { await h.close(); });

describe('대상 밖·이름 추정·재발급 중복', () => {
  it('대상 밖 수료증 3개는 교육을 자동 선택하지 않되 수료증 자체와 구분한다', async () => {
    for (const sample of additionalCertificateSamples.filter(s => !s.target)) {
      const row = current.find(d => d.fileName === sample.file)!;
      const detail = (await h.send('GET', `/api/certificates/${row.id}`)).json() as CertificateDetail;
      expect(detail.trainingIds).toEqual([]);
      expect(detail.flags.map(f => f.code)).toContain('no-training');
      expect(detail.flags.map(f => f.code)).not.toContain('not-certificate');
      expect(detail.flags.find(f => f.code === 'no-training')?.message).toContain('현재 관리 대상');
    }
    expect(current.find(d => d.fileName === 'report (12).pdf')?.flags.map(f => f.code)).toContain('training-weak-keyword');
  });

  it('바이트가 다른 재발급본 6개도 중복 표시하고 기존 확정 2개를 보존한다', async () => {
    const copies = additionalCertificateSamples.filter(s => s.duplicateOf);
    expect(copies).toHaveLength(6);
    for (const sample of copies) expect(current.find(d => d.fileName === sample.file)?.flags.map(f => f.code)).toContain('duplicate');
    const protectedAfter = await h.db.selectFrom('certificates').selectAll().where('status', '=', 'confirmed').orderBy('id').execute();
    expect(protectedAfter).toEqual(protectedCertificates);
  });

  it('추가 20개 중 대상 밖·추정 후보·중복을 빼고 10개만 일괄 확정한다', async () => {
    const names = new Set(additionalCertificateSamples.map(s => s.file));
    const ids = current.filter(d => names.has(d.fileName)).map(d => d.id);
    const result = (await h.send('POST', '/api/certificates/bulk-confirm', { ids })).json();
    expect(result.confirmed).toBe(10);
    expect(result.skipped).toHaveLength(10);
    const candidate = current.find(d => d.fileName === 'report (17).pdf')!;
    expect(candidate.flags.map(f => f.code)).toContain('training-name-suggestion');
    expect(result.skipped.some((s: { id: number }) => s.id === candidate.id)).toBe(true);
  });

  it('이미 확정된 동일 증서의 재발급본은 수동 확정으로도 중복 집계하지 않는다', async () => {
    const row = current.find(d => d.fileName === 'report (25).pdf')!;
    const detail = (await h.send('GET', `/api/certificates/${row.id}`)).json() as CertificateDetail;
    const body: CertificateInput = { employeeId: detail.employee!.id, credits: detail.credits, completedOn: detail.completedOn, hours: detail.hours,
      courseTitle: detail.courseTitle, provider: detail.provider, certNo: detail.certNo, year: detail.year };
    const result = await h.send('POST', `/api/certificates/${row.id}/confirm`, body);
    expect(result.statusCode).toBe(422);
    expect(result.json().error.message).toContain('이미 확정');
    expect((await h.send('GET', `/api/certificates/${row.id}`)).json().status).toBe('draft');
  });

  it('교육·날짜가 달라도 같은 직원·기관·증서번호면 중복 후보로 표시한다', async () => {
    const original = narabaeumSamples[0];
    await putSample(original, '날짜다른재발급.pdf', original.text.replaceAll('2026.05.07.', '2026.06.08.').replaceAll('2026년 05월 07일', '2026년 06월 08일').replaceAll(original.expected.courseTitle!, '특별 실무 학습'));
    await h.drainQueue();
    const row = (await h.send('GET', '/api/certificates?status=draft')).json().find((d: CertificateListItem) => d.fileName === '날짜다른재발급.pdf');
    expect(row.trainingIds).toEqual([]);
    expect(row.flags.map((f: { code: string }) => f.code)).toContain('duplicate');
  });

  it('다른 발급기관의 같은 번호를 동일 증서로 단정하지 않는다', async () => {
    const original = narabaeumSamples[0];
    const text = original.text.replaceAll('2026.05.07.', '2026.06.09.').replaceAll('2026년 05월 07일', '2026년 06월 09일')
      .replaceAll(original.expected.courseTitle!, '특별 실무 학습').replaceAll(original.expected.provider!, '다른교육연수원');
    await putSample(original, '다른기관.pdf', text);
    await h.drainQueue();
    const row = (await h.send('GET', '/api/certificates?status=draft')).json().find((d: CertificateListItem) => d.fileName === '다른기관.pdf');
    expect(row.flags.map((f: { code: string }) => f.code)).not.toContain('duplicate');
  });

  it('직원 이름·교육명이 있는 안내문도 이수 증빙으로 자동 연결하지 않는다', async () => {
    await putSample(narabaeumSamples[0], '교육안내.pdf', '교육 안내\n성명: 홍길동\n과정명: 청렴교육\n교육일: 2026.07.01.\n교육시간: 2시간\n수료증은 교육 종료 후 발급될 예정입니다.');
    await h.drainQueue();
    const row = (await h.send('GET', '/api/certificates?status=draft')).json().find((d: CertificateListItem) => d.fileName === '교육안내.pdf');
    expect(row.trainingIds).toEqual([]);
    expect(row.flags.map((f: { code: string }) => f.code)).toContain('not-certificate');
    expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [row.id] })).json().confirmed).toBe(0);
  });
});
