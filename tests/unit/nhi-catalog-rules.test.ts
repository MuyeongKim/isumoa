import { describe, expect, it } from 'vitest';
import { classifyTrainings, courseTitleKey, trainingScopeConflict } from '../../server/src/certs/trainingClassifier.ts';
import { managedTrainingSamples } from '../fixtures-certificates.ts';
const catalog = managedTrainingSamples.map((t, i) => ({ ...t, id: i + 1, applicable: true }));
const id = (name: string) => catalog.find(t => t.name === name)!.id;

describe('공식 나라배움터 목록으로 보완한 주제 구분', () => {
  it.each([
    ['자살예방 인식개선교육[2026-1기]', '자살예방교육'],
    ['우리가 알아야 할 정보공개제도[2026-1기]', '정보공개교육'],
    ['[mobile겸용] 긴급복지지원 신고의무 교육(수어통역)', '긴급복지신고의무자교육'],
    ['고용노동부와 보건복지부가 함께하는 장애인식개선교육 「우리가 사는 법」[2026-1기]', '장애인식개선 교육'],
  ])('%s는 명시된 주제로 후보를 찾는다', (title, target) => {
    expect(classifyTrainings(title, '', catalog, new Map()).trainingIds).toEqual([id(target)]);
  });
  it('목록의 기수를 제거해 수료증 제목과 기존 확정 매핑을 함께 쓴다', () => {
    const title = '우리가 알아야 할 정보공개제도';
    expect(courseTitleKey(`${title}[2026-1기]`)).toBe(courseTitleKey(title));
    expect(courseTitleKey('4대 폭력예방교육[2027-2기]')).toBe(courseTitleKey('4대 폭력예방교육'));
    const learned = new Map([[courseTitleKey(`${title}[2026-1기]`), [id('정보공개교육')]]]);
    expect(classifyTrainings(title, '', catalog, learned).source).toBe('learned');
  });
  it.each([
    ['정보보안교육', '정보공개교육'],
    ['컴퓨터 네트워크 및 보안[2026-1기]', '정보공개교육'],
    ['긴급자동차 교통안전교육', '긴급복지신고의무자교육'],
  ])('%s는 잘못 학습한 연결도 재사용하지 않는다', (title, wrong) => {
    const result = classifyTrainings(title, '', catalog, new Map([[courseTitleKey(title), [id(wrong)]]]));
    expect(result.trainingIds).toEqual([]);
    expect(result.scopeConflicts).toHaveLength(1);
  });
  it('사용자 검색어에 다른 주제를 넣어도 자동 연결을 막는다', () => {
    const result = classifyTrainings('정보보안교육', '', [{ id: 1, name: '정보공개교육', keywords: ['정보보안'], applicable: true }], new Map());
    expect(result.trainingIds).toEqual([]);
    expect(result.scopeConflicts).toHaveLength(1);
  });
  it('제목에 양쪽 주제가 있는 통합과정 및 실제 보안교육을 과도하게 막지 않는다', () => {
    expect(trainingScopeConflict('정보공개와 정보보안 통합교육', { name: '정보공개교육' })).toBeNull();
    expect(trainingScopeConflict('긴급복지와 교통안전교육', { name: '긴급복지신고의무자교육' })).toBeNull();
    expect(trainingScopeConflict('정보보안교육', { name: '정보보안교육' })).toBeNull();
  });
});
