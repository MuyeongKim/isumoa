import { describe, expect, it } from 'vitest';
import { extractTrainingDrafts, trainingTableFromOcr } from '../../server/src/trainings/document.ts';
import { trainingTableOcr } from '../fixtures-training-document.ts';

describe('교육 문서 판독', () => {
  it('기준을 추측하지 않고 누락을 표시한다', () => {
    expect(extractTrainingDrafts([], '교육명: 기관 특별교육\n교육대상: 모든 직원')).toMatchObject([
      { name: '기관 특별교육', reqType: null, reqValue: null, legalBasis: null },
    ]);
  });
  it('다른 교육의 기준을 앞 교육으로 끌어오지 않는다', () => {
    const rows = extractTrainingDrafts([], '교육명: 첫째교육\n대상: 전 직원\n교육명: 둘째교육\n이수기준: 연 2시간');
    expect(rows[0].reqValue).toBeNull();
    expect(rows[1].reqValue).toBe(2);
  });
  it('같은 교육의 다른 기준은 확인 대상으로 표시한다', () => {
    const rows = extractTrainingDrafts([], '교육명: 안전교육\n이수기준: 연 1회\n교육명: 안전교육\n이수기준: 연 2시간');
    expect(rows).toHaveLength(1);
    expect(rows[0].warnings.join(' ')).toContain('다른 기준');
  });
  it('괄호가 붙은 교육 이름을 보존한다', () => {
    const rows = extractTrainingDrafts([], '교육명: 예시 안전교육(공무원)\n이수기준: 연 2시간');
    expect(rows[0].name).toBe('예시 안전교육(공무원)');
  });
  it('사진 OCR의 띄어 쓴 과정명과 콜론 없는 항목을 읽는다', () => {
    const rows = extractTrainingDrafts([], '과 정 명    사진 안전교육\n교육시간 2시간\n교 육 명    사진 정보보호교육\n교육시간 30분');
    expect(rows.map(r => [r.name, r.reqValue])).toEqual([['사진 안전교육', 2], ['사진 정보보호교육', 0.5]]);
  });

  it('기울어진 표 사진의 교육주제·검색어·기준을 같은 행으로 묶는다', async () => {
    const ocr = await trainingTableOcr();
    const drafts = extractTrainingDrafts(trainingTableFromOcr(ocr.lines), ocr.text);
    expect(drafts.map(d => d.name)).toEqual([
      '감염병 예방관리및위기대응', '성인지 감수성+4대 폭력예방교육', '청탁금지법등반부패·청렴교육',
      '통일의식 교육', '장애인식개선 교육', '아동학대 예방 교육', '인권교육(도 조례)',
      '자살예방교육', '이해충돌방지법', '긴급복지신고의무자교육', '정보공개교육', '적극행정실천 교육',
      '개인정보보호교육', '공직자안보교육', '성별영향평가',
    ]);
    expect(drafts.map(d => d.reqValue)).toEqual([1, 5, 5, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(drafts.every(d => d.reqType === 'hours')).toBe(true);
    expect(drafts[0].keywords).toEqual(['감염병']);
    expect(drafts[1].keywords).toEqual(['성인지', '4대 폭력']);
    expect(drafts[1].note).toContain('임용후2개월');
    expect(drafts[12].note).toContain('수강신청: 특자도');
    expect(drafts[9].warnings.join(' ')).toContain('키워드');
    expect(drafts.every(d => !d.name.includes('√') && !d.name.includes('수강신청사이트'))).toBe(true);
  });

  it('번호가 누락된 사진 표를 임의로 합쳐서 해석하지 않는다', async () => {
    const ocr = await trainingTableOcr();
    expect(trainingTableFromOcr(ocr.lines.filter(line => line.text !== '7'))).toEqual([]);
  });
});
