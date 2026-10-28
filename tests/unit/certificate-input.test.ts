import { expect, it } from 'vitest';
import type { CertificateInput } from '../../shared/types.ts';
import { certificateInputKey } from '../../shared/certificateInput.ts';
const base: CertificateInput = { employeeId: 1, credits: [{ trainingId: 2, creditedHours: 1 }, { trainingId: 1, creditedHours: null }], completedOn: '2026-04-01', hours: 1, courseTitle: '청렴교육', provider: null, certNo: null, year: 2026 };
it('교육 선택 순서와 공백 때문에 저장한 검수값을 다시 미저장으로 표시하지 않는다', () => {
  const order = base.credits.map(c => c.trainingId);
  expect(certificateInputKey({ ...base, courseTitle: ' 청렴교육 ', provider: ' ', credits: [...base.credits].reverse() })).toBe(certificateInputKey(base));
  expect(base.credits.map(c => c.trainingId)).toEqual(order);
});
it('시간 미기재와 0시간은 구분해 수정값을 놓치지 않는다', () => {
  expect(certificateInputKey({ ...base, credits: [{ trainingId: 1, creditedHours: 0 }, base.credits[0]] })).not.toBe(certificateInputKey(base));
});
it('직원·교육·날짜·시간·과정·기관·증서번호·연도 변경을 각각 감지한다', () => {
  const changes: Partial<CertificateInput>[] = [{ employeeId: 2 }, { credits: [] }, { completedOn: '2026-04-02' }, { hours: 2 }, { courseTitle: '다른 과정' }, { provider: '가상연수원' }, { certNo: 'FAKE-01' }, { year: 2025 }];
  for (const change of changes) expect(certificateInputKey({ ...base, ...change })).not.toBe(certificateInputKey(base));
});
