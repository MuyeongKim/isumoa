import { UNIEDU_PUBLIC_COURSES, UNIEDU_SCHEDULED_COURSES } from '../../shared/unieduCatalog.ts';
import { describe, expect, it } from 'vitest';
import { classifyTrainings, courseTitleKey, trainingScopeConflict, unieduCertificateFlags } from '../../server/src/certs/trainingClassifier.ts';

const trainings = [
  { id: 1, name: '통일의식 교육', keywords: ['통일'], applicable: true },
  { id: 2, name: '공직자안보교육', keywords: ['안보'], applicable: true },
];
const context = { provider: '국립평화통일민주교육원', year: 2026 };

describe('국립통일교육원 공식 과정과 발급기관 대조', () => {
  it('통일이라는 단어가 없는 공식 과정도 통일교육 후보로 연결한다', () => {
    expect(classifyTrainings('우주에서 본 북한', '', trainings, new Map(), context).trainingIds).toEqual([1]);
  });
  it('공식 통일교육은 안보 키워드보다 우선하며 안보교육에 중복 연결하지 않는다', () => {
    expect(classifyTrainings('북핵 문제와 동북아 안보 상황', '', trainings, new Map(), context).trainingIds).toEqual([1]);
    expect(trainingScopeConflict('북핵 문제와 동북아 안보 상황', trainings[1], context)).toContain('통일교육');
  });
  it('확정 후 저장된 동명 연결도 다른 기관으로 확장하지 않는다', () => {
    const learned = new Map([[courseTitleKey('헌법으로 본 통일'), [1]]]);
    expect(classifyTrainings('헌법으로 본 통일', '', trainings, learned, { ...context, provider: '민간교육센터' }).trainingIds).toEqual([]);
  });
});


describe('공식 목록의 범위와 예외', () => {
  it.each(UNIEDU_PUBLIC_COURSES)('$title은 발급기관이 확인된 2026년 통일교육으로만 연결한다', course => {
    const result = classifyTrainings(course.title, '', trainings, new Map(), context);
    expect(result).toMatchObject({ trainingIds: [1], source: 'catalog' });
    expect(unieduCertificateFlags(course.title, { ...context, hours: course.recognizedHours })).toEqual([]);
  });
  it('9기 47개와 예정 1개를 분리한다', () => {
    expect(UNIEDU_PUBLIC_COURSES).toHaveLength(47);
    expect(UNIEDU_SCHEDULED_COURSES).toHaveLength(1);
    const title = UNIEDU_SCHEDULED_COURSES[0];
    expect(classifyTrainings(title, '', trainings, new Map([[courseTitleKey(title), [1]]]), context).trainingIds).toEqual([]);
    expect(unieduCertificateFlags(title, context)[0].message).toContain('개설 예정');
  });
  it.each(['통일교육원', '국립통일교육원', '통일부 국립통일교육원장', '국립평화통일민주교육원장'])('이전·현재 발급기관명 %s를 대조한다', provider => {
    expect(classifyTrainings('남북의 밤하늘', '', trainings, new Map(), { ...context, provider }).trainingIds).toEqual([1]);
  });
  it.each([null, '', '민간통일교육원', '국립통일교육원 협력센터', '북한연구소'])('기관 %j에는 공식 과정 연결과 기존 학습 연결을 확대하지 않는다', provider => {
    for (const title of ['헌법으로 본 통일', '반도체 전쟁']) {
      expect(classifyTrainings(title, '', trainings, new Map([[courseTitleKey(title), [1]]]), { ...context, provider }).trainingIds).toEqual([]);
    }
  });
  it.each([2025, 2027, null])('확인하지 않은 연도 %j에 2026년 목록을 적용하지 않는다', year => {
    expect(classifyTrainings('남북의 밤하늘', '', trainings, new Map([[courseTitleKey('남북의 밤하늘'), [1]]]), { ...context, year }).trainingIds).toEqual([]);
  });
  it('과정명이 아닌 문서 본문의 목록·기관명만으로 공식 후보를 채우지 않는다', () => {
    expect(classifyTrainings(null, '국립통일교육원 과정표 우주에서 본 북한', trainings, new Map(), context).trainingIds).toEqual([]);
    expect(classifyTrainings('반도체 설계 입문', '국립통일교육원 공식 과정은 반도체 전쟁입니다.', trainings, new Map(), context).trainingIds).toEqual([]);
  });
  it.each(['평화⿆통일미디어 리터러시: 북한 정보⿆매체읽기', '북핵 문제와 동북아 안보 상황 미확인 변형', '새로운 통일교육'])('깨진 제목·미확인 과정 %s는 일반 키워드와 기존 매핑으로 우회 연결하지 않는다', title => {
    expect(classifyTrainings(title, '', trainings, new Map([[courseTitleKey(title), [1, 2]]]), context).trainingIds).toEqual([]);
    expect(unieduCertificateFlags(title, context)[0].message).toContain('과정명이 일치하지');
  });
  it.each(['마이크로러닝', '이수증 미발급', '수료증 미발급'])('%s 표시가 있으면 정규 수료증처럼 자동 연결하지 않는다', text => {
    expect(classifyTrainings('헌법으로 본 통일', text, trainings, new Map([[courseTitleKey('헌법으로 본 통일'), [1]]]), context).trainingIds).toEqual([]);
    expect(unieduCertificateFlags('헌법으로 본 통일', { ...context, fullText: text })[0].message).toContain('정규과정');
  });
  it('기수·띄어쓰기·로마숫자 표기는 맞추면서 Ⅰ/Ⅱ/Ⅲ를 구별한다', () => {
    expect(classifyTrainings('제9기 북한 인사이드: 북한 사회와 주민 이해 II [2026-9기]', '', trainings, new Map(), context).trainingIds).toEqual([1]);
    expect(unieduCertificateFlags('북한 인사이드: 북한 사회와 주민 이해Ⅱ', { ...context, hours: 6 })[0].message).toContain('8시간');
    expect(unieduCertificateFlags('북한 인사이드: 북한 사회와 주민 이해Ⅰ', { ...context, hours: 6 })).toEqual([]);
  });
  it('휴지통·비활성 교육과 둘 이상의 통일교육 중 하나를 임의로 고르지 않는다', () => {
    expect(classifyTrainings('남북의 밤하늘', '', [{ ...trainings[0], applicable: false }, trainings[1]], new Map(), context)).toMatchObject({ trainingIds: [], inactiveMatches: ['통일의식 교육'] });
    expect(classifyTrainings('남북의 밤하늘', '', [trainings[0], { ...trainings[0], id: 3, name: '통일교육' }], new Map(), context).trainingIds).toEqual([]);
    expect(classifyTrainings('남북의 밤하늘', '', [trainings[1]], new Map(), context).trainingIds).toEqual([]);
  });
  it('잘못 학습된 안보 연결은 재사용하지 않고 공식 통일 후보를 고른다', () => {
    const title = '북핵 문제와 동북아 안보 상황';
    expect(classifyTrainings(title, '', trainings, new Map([[courseTitleKey(title), [2]]]), context)).toMatchObject({ trainingIds: [1], source: 'catalog', scopeConflicts: [expect.stringContaining('통일교육')] });
    expect(trainingScopeConflict(title, trainings[0], context)).toBeNull();
    expect(trainingScopeConflict(title, trainings[1], { ...context, provider: '다른기관' })).toBeNull();
  });
  it('목록 시간은 검수 참고값으로만 쓴다', () => {
    expect(unieduCertificateFlags('우주에서 본 북한', { ...context, hours: 0.5 })[0].message).toContain('수료증 시간을 유지');
    expect(unieduCertificateFlags('우주에서 본 북한', { ...context, hours: null })).toEqual([]);
  });
});
