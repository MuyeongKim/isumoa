import { describe, expect, it } from 'vitest';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import { classifyTrainings } from '../../server/src/certs/trainingClassifier.ts';
import { additionalCertificateSamples, managedTrainingSamples } from '../fixtures-certificates.ts';

const catalog = managedTrainingSamples.map((training, i) => ({ id: i + 1, name: training.name, keywords: training.keywords, applicable: true }));

describe('추가 수료증 20개: 문서 판독과 관리 범위를 분리', () => {
  for (const sample of additionalCertificateSamples) {
    it(`${sample.file}: 원본 값과 관리 교육 연결을 대조한다`, () => {
      const parsed = parseCertificateText(sample.text);
      expect(parsed).toEqual(sample.expected);
      const result = classifyTrainings(parsed.courseTitle, sample.text, catalog, new Map());
      expect(result.trainingIds.map(id => catalog.find(t => t.id === id)?.name)).toEqual(sample.target ? [sample.target] : []);
      if (sample.requiresReview) expect(result.source).toBe('name');
      if (!sample.target) expect(parsed.looksLikeCertificate).toBe(true);
    });
  }

  it('긴급자동차를 긴급복지로 매칭하지 않고 실제 긴급복지지원 과정은 연결한다', () => {
    const wrong = classifyTrainings('긴급자동차 교통안전교육(정기)', '', catalog, new Map());
    expect(wrong.trainingIds).toEqual([]);
    expect(wrong.ignoredKeywords).toContain('긴급');
    const valid = classifyTrainings('긴급복지지원 신고의무 교육', '', catalog, new Map());
    expect(valid.trainingIds.map(id => catalog.find(t => t.id === id)?.name)).toEqual(['긴급복지신고의무자교육']);
  });

  it('수료 예정 안내문을 수료증으로 해석하지 않는다', () => {
    const parsed = parseCertificateText('교육 안내\n성명: 홍길동\n과정명: 청렴교육\n교육일: 2026.04.01.\n교육시간: 2시간\n수료증은 교육이 끝나면 발급됩니다.');
    expect(parsed.looksLikeCertificate).toBe(false);
  });

  it('머리글이 잘린 경우에도 증서번호·발급기관·수료 항목이 명확하면 판독한다', () => {
    const parsed = parseCertificateText('제 TEST2026-1234 호\n성명: 홍길동\n과정명: 청렴교육\n교육기간: 2026.04.01.~2026.04.01.\n교육시간: 2시간\n가상연수원장');
    expect(parsed.looksLikeCertificate).toBe(true);
  });
});
