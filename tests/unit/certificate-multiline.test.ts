import { expect, it } from 'vitest';
import { hasUsableText, parseCertificateText } from '../../server/src/certs/parseText.ts';

const identity = ['수료증', '성명', '홍길동', '생년월일', '1981-03-02', '과정명', '개인정보보호 교육'];
it('항목 다음 줄의 생년월일·이수일을 각각 연결하고 출생일을 이수일로 쓰지 않는다', () => {
  const c = parseCertificateText([...identity, '이수일', '2026-05-03', '교육시간', '1시간', '교육기관', '가상미래교육원'].join('\n'));
  expect(c).toMatchObject({ personBirth: '1981-03-02', completedOn: '2026-05-03', hours: 1, courseTitle: '개인정보보호 교육', looksLikeCertificate: true });
});
it('항목 다음 줄의 기간은 마지막 날을 이수일로 사용한다', () => {
  expect(parseCertificateText([...identity, '교육기간', '2026. 5. 1. ~ 2026. 5. 3.', '교육시간 : 1시간'].join('\n')).completedOn).toBe('2026-05-03');
});
it('생년월일만 있는 문서를 이수 완료로 판독하지 않는다', () => {
  expect(parseCertificateText(identity.join('\n'))).toMatchObject({ personBirth: '1981-03-02', completedOn: null, looksLikeCertificate: false });
});
it('날짜 항목이 다른 항목으로 끊기면 그 항목의 날짜를 끌어오지 않는다', () => {
  expect(parseCertificateText(['수료증', '성명 : 홍길동', '이수일', '생년월일 : 1981-03-02', '과정명 : 개인정보보호 교육'].join('\n')).completedOn).toBeNull();
});
it('글자 수가 많아도 손상된 PDF 문자 정보는 OCR 대상으로 돌린다', () => {
  const good = [...identity, '이수일 : 2026-05-03', '교육시간 : 1시간'].join('\n');
  expect(hasUsableText(good)).toBe(true);
  expect(hasUsableText(good.replace('보호', '보⿆호'))).toBe(false);
  expect(hasUsableText(good + '\uFFFD')).toBe(false);
});

it('교육기간의 시작·끝 날짜가 각각 다른 줄이면 마지막 날을 연결한다', () => {
  expect(parseCertificateText([...identity, '교육기간', '2026. 5. 1.', '~', '2026. 5. 3.', '교육시간 : 1시간'].join('\n')).completedOn).toBe('2026-05-03');
});
it('단일 기간 시작일이나 여러 무표제 날짜는 경고 없이 이수일로 확정하지 않는다', () => {
  for (const lines of [['교육기간 : 2026-05-01'], ['2026-05-01', '2026-05-03']]) {
    const parsed = parseCertificateText([...identity, ...lines, '교육시간 : 1시간'].join('\n'));
    expect(parsed.completedOn === null || parsed.notes.some(n => n.code === 'date-inferred')).toBe(true);
  }
});
