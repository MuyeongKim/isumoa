import type { CertificateDetail, CertificateInput } from './types.ts';

export function certificateInputOf(detail: CertificateDetail): CertificateInput {
  return {
    employeeId: detail.employee?.id ?? null,
    credits: detail.credits,
    completedOn: detail.completedOn,
    hours: detail.hours,
    courseTitle: detail.courseTitle,
    provider: detail.provider,
    certNo: detail.certNo,
    year: detail.year ?? detail.batchYear,
  };
}

/** 교육 선택 순서와 객체 키 순서가 달라도 같은 저장값은 변경으로 보지 않는다. */
export function certificateInputKey(input: CertificateInput): string {
  const text = (value: string | null) => value?.trim() || null;
  return JSON.stringify([
    input.employeeId,
    [...input.credits].sort((a, b) => a.trainingId - b.trainingId).map(c => [c.trainingId, c.creditedHours]),
    text(input.completedOn), input.hours, text(input.courseTitle), text(input.provider), text(input.certNo), input.year,
  ]);
}
