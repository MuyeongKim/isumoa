import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CertificateDetail, CertificateInput, CertificateListItem, StatusReport } from '../../shared/types.ts';
import { narabaeumSamples } from '../fixtures-certificates.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

let h: Harness;
let violenceId: number;
let employeeId: number;
let drafts: CertificateListItem[];

beforeAll(async () => {
  h = await createHarness();
  const departmentId = (await h.send('POST', '/api/departments', { name: '119구조대' })).json().id;
  employeeId = (await h.send('POST', '/api/employees', { name: '홍길동', departmentId, empNo: 'TEST1001' })).json().id;
  for (const [name, reqValue, keywords] of [
    ['4대 폭력예방교육', 5, ['4대 폭력']], ['인권교육(도 조례)', 2, ['행정과인권']],
    ['긴급복지신고의무자교육', 1, ['긴급', '복지신고']], ['성별영향평가', 1, ['성별']], ['공직자 안보교육', 1, ['안보']],
  ] as const) {
    const response = await h.send('POST', '/api/trainings', { name, reqType: 'hours', reqValue, keywords });
    if (name === '4대 폭력예방교육') violenceId = response.json().id;
  }
  const batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  for (const [index, sample] of narabaeumSamples.entries()) {
    const file = await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from(`fixture-${index}`)]), sample.file);
    await h.uploadPage(file.json().fileId, 1, sample.text);
  }
  expect(await h.drainQueue()).toEqual([]);
  drafts = (await h.send('GET', '/api/certificates?status=draft')).json();
});

afterAll(async () => { await h.close(); });

describe('실제 서식을 바탕으로 한 수료증 처리', () => {
  it('쪽 처리부터 검수함까지 6개 과정명·직원·일자·시간을 유지한다', async () => {
    expect(drafts).toHaveLength(6);
    for (const sample of narabaeumSamples) {
      const draft = drafts.find(d => d.fileName === sample.file)!;
      const response = await h.send('GET', `/api/certificates/${draft.id}`);
      const detail = response.json() as CertificateDetail;
      expect(detail).toMatchObject({
        personName: sample.expected.personName, personDept: sample.expected.personDept, employee: { id: employeeId },
        courseTitle: sample.expected.courseTitle, completedOn: sample.expected.completedOn, hours: sample.expected.hours,
        provider: sample.expected.provider, certNo: sample.expected.certNo,
      });
      expect(detail.trainingIds).toHaveLength(1);
      expect(detail.flags.some(flag => flag.code === 'dept-differs' || flag.code === 'no-training')).toBe(false);
    }
  });

  it('교육명으로 추정한 2건은 경고를 표시하고 일괄 확정에서 제외한다', async () => {
    const result = (await h.send('POST', '/api/certificates/bulk-confirm', { ids: drafts.map(d => d.id) })).json();
    expect(result.confirmed).toBe(4);
    expect(result.skipped).toHaveLength(2);
    for (const file of ['report (1).pdf', 'report (2).pdf']) {
      const draft = drafts.find(d => d.fileName === file)!;
      expect(result.skipped.some((s: { id: number }) => s.id === draft.id)).toBe(true);
      const detail = (await h.send('GET', `/api/certificates/${draft.id}`)).json() as CertificateDetail;
      expect(detail.flags.map(f => f.code)).toContain('training-name-suggestion');
    }
  });

  it('4시간 수료증을 사람이 확인해 확정해도 5시간 기준의 이수 완료로 올리지 않는다', async () => {
    const draft = drafts.find(d => d.fileName === 'report (1).pdf')!;
    const detail = (await h.send('GET', `/api/certificates/${draft.id}`)).json() as CertificateDetail;
    const body: CertificateInput = { employeeId, credits: detail.credits, completedOn: detail.completedOn, hours: detail.hours, courseTitle: detail.courseTitle, provider: detail.provider, certNo: detail.certNo, year: detail.year };
    const confirmed = await h.send('POST', `/api/certificates/${draft.id}/confirm`, body);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const report = (await h.send('GET', '/api/status?year=2026')).json() as StatusReport;
    expect(report.rows.find(r => r.employeeId === employeeId)?.cells[violenceId]).toMatchObject({ state: 'partial', hours: 4, note: '4시간 / 연 5시간' });
  });

  it('과정명을 읽지 못한 채 문서 전체의 단어로 분류하면 확인 표시를 남긴다', async () => {
    const batch = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
    const file = (await h.uploadFile(batch, Buffer.concat([PDF, Buffer.from('no-course')]), '과정명없는증빙.pdf')).json().fileId;
    await h.uploadPage(file, 1, '수료증\n성명: 홍길동\n교육내용: 공직자 청렴 학습\n이수일자: 2026.06.01.\n교육시간: 2시간');
    await h.drainQueue();
    const draft = (await h.send('GET', '/api/certificates?status=draft')).json().find((d: CertificateListItem) => d.fileName === '과정명없는증빙.pdf');
    expect(draft.flags.map((f: { code: string }) => f.code)).toContain('training-text-suggestion');
    expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: [draft.id] })).json().confirmed).toBe(0);
  });
});
