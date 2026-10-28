import { describe, expect, it } from 'vitest';
import { parseCertificateText, parseHours } from '../../server/src/certs/parseText.ts';
import { classifyTrainings, courseTitleKey } from '../../server/src/certs/trainingClassifier.ts';
import { narabaeumSamples } from '../fixtures-certificates.ts';

describe('나라배움터 수료증 서식', () => {
  for (const sample of narabaeumSamples) {
    it(`${sample.file}: 과정·기간·상시학습인정시간과 기관·부서를 읽는다`, () => {
      expect(parseCertificateText(sample.text)).toEqual(sample.expected);
    });
  }

  it('항목 이름 다음 줄의 값과 여러 줄 과정명을 읽되 증명 문구는 붙이지 않는다', () => {
    const parsed = parseCertificateText('수료증\n성명:\n홍길동\n과정:\n제 9 기 [Mobile 겸용] 사례로 알아보는 사업\n성별영향평가\n기간: 2026.04.01. ~ 2026.04.06.\n상시학습인정시간: 1시간\n위 사람은 소정의 교육과정을 마쳤으므로 이 증을 수여합니다.\n2026년 4월 10일');
    expect(parsed).toMatchObject({ personName: '홍길동', courseTitle: '제 9 기 [Mobile 겸용] 사례로 알아보는 사업 성별영향평가', completedOn: '2026-04-06', hours: 1 });
  });

  it('짧은 단어가 들어간 안내 문장을 과정 항목으로 해석하지 않는다', () => {
    expect(parseCertificateText('과정 안내 사항입니다.\n기간 동안 열심히 학습하세요.\n2026년 4월 6일').courseTitle).toBeNull();
  });

  it('PDF 변환기의 한 줄 합침과 값 뒤에 붙은 과정 머리글도 확인 표시와 함께 복구한다', () => {
    const parsed = parseCertificateText('수료증\n성명: 홍길동\n제9기 [Mobile 겸용] 사례로 알아보는 사업과 정 :\n성별영향평가\n기 간 : 2026.04.06. ~ 2026.04.06. 상시학습인정시간 : 1시간');
    expect(parsed).toMatchObject({ courseTitle: '제9기 [Mobile 겸용] 사례로 알아보는 사업 성별영향평가', completedOn: '2026-04-06', hours: 1 });
    expect(parsed.notes.map(n => n.code)).toContain('reading-order-recovered');
  });

  it('시간과 차시가 함께 있으면 명시된 시간만 사용하고 차시는 임의 환산하지 않는다', () => {
    expect(parseHours('4시간(8차시)')).toMatchObject({ hours: 4, sessions: false });
    expect(parseHours('8차시')).toMatchObject({ hours: null, sessions: true });
  });

  it('이수일을 추정해서 채운 경우에는 확인 표시를 남긴다', () => {
    const parsed = parseCertificateText('수료증\n성명: 홍길동\n과정명: 교육\n발급 확인 내역: 2026. 4. 6.');
    expect(parsed.completedOn).toBe('2026-04-06');
    expect(parsed.notes.map(n => n.code)).toContain('date-inferred');
  });
});

describe('기수·매체 표기와 교육 후보 분류', () => {
  it('기수·연도·모바일 겸용 표기가 달라도 같은 확정 매핑을 쓴다', () => {
    expect(courseTitleKey('제 9 기 [Mobile 겸용] 2026 공직자 안보교육 (2025년 개발)')).toBe(courseTitleKey('제 10 기 2027 공직자 안보교육'));
    const catalog = [{ id: 1, name: '공직자 안보교육', keywords: [], applicable: true }];
    const legacy = new Map([['제9기mobile겸용공직자안보교육', [1]]]);
    expect(classifyTrainings('제 10 기 공직자 안보교육', '', catalog, legacy)).toMatchObject({ trainingIds: [1], source: 'learned' });
  });

  it('서로 다르게 확정했던 매핑은 임의로 합치지 않는다', () => {
    const catalog = [{ id: 1, name: '첫째', keywords: [], applicable: true }, { id: 2, name: '둘째', keywords: [], applicable: true }];
    const legacy = new Map([['제9기특별과정', [1]], ['제10기특별과정', [2]]]);
    expect(classifyTrainings('제 11 기 특별과정', '', catalog, legacy).trainingIds).toEqual([]);
  });

  it('키워드가 맞지 않으면 유일한 교육명 후보를 확인 대상으로 제안한다', () => {
    const catalog = [{ id: 1, name: '인권교육(도 조례)', keywords: ['행정과인권'], applicable: true }, { id: 2, name: '4대 폭력예방교육', keywords: ['4대폭력'], applicable: true }];
    expect(classifyTrainings('제 9 기 인권의 이해 입문편', '', catalog, new Map())).toMatchObject({ trainingIds: [1], source: 'name' });
    expect(classifyTrainings('제 9 기 평등한 일상, 폭력예방교육(일반)', '', catalog, new Map())).toMatchObject({ trainingIds: [2], source: 'name' });
  });

  it('일반적인 이름이나 여러 교육이 겹친 경우 이름만으로 고르지 않는다', () => {
    expect(classifyTrainings('기본교육', '', [{ id: 1, name: '기본교육', keywords: [], applicable: true }], new Map()).trainingIds).toEqual([]);
    const catalog = [{ id: 1, name: '인권교육', keywords: [], applicable: true }, { id: 2, name: '인권교육(특별)', keywords: [], applicable: true }];
    expect(classifyTrainings('인권의 이해', '', catalog, new Map()).trainingIds).toEqual([]);
  });
});
