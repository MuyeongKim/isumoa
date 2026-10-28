import { readFileSync } from 'node:fs';
import type { ParsedCertificate } from '../server/src/certs/parseText.ts';

export interface CertificateSample {
  file: string;
  text: string;
  expected: ParsedCertificate;
}

export const narabaeumSamples = (JSON.parse(readFileSync(new URL('./fixtures/narabaeum-certificates.json', import.meta.url), 'utf8')) as { cases: CertificateSample[] }).cases;

export interface AdditionalCertificateSample extends CertificateSample {
  target: string | null;
  requiresReview: boolean;
  duplicateOf: string | null;
}

export const additionalCertificateSamples = (JSON.parse(readFileSync(new URL('./fixtures/additional-certificates.json', import.meta.url), 'utf8')) as { cases: AdditionalCertificateSample[] }).cases;

/** 번호 표에서 확인한 관리 목록. '긴급'처럼 잘못 나뉜 검색어도 회귀 검사에 포함한다. */
export const managedTrainingSamples: { name: string; reqType: 'hours' | 'count'; reqValue: number; keywords: string[] }[] = [
  { name: '개인정보보호 교육', reqType: 'count', reqValue: 1, keywords: ['개인정보'] },
  { name: '감염병 예방관리및위기대응', reqType: 'hours', reqValue: 1, keywords: ['감염병'] },
  { name: '4대 폭력예방교육', reqType: 'hours', reqValue: 5, keywords: ['4대 폭력'] },
  { name: '청탁금지법등반부패·청렴교육', reqType: 'hours', reqValue: 5, keywords: ['청렴'] },
  { name: '통일의식 교육', reqType: 'hours', reqValue: 1, keywords: ['통일'] },
  { name: '장애인식개선 교육', reqType: 'hours', reqValue: 1, keywords: ['장애인식'] },
  { name: '아동학대 예방 교육', reqType: 'hours', reqValue: 1, keywords: ['아동학대'] },
  { name: '인권교육(도 조례)', reqType: 'hours', reqValue: 2, keywords: ['행정과인권'] },
  { name: '자살예방교육', reqType: 'hours', reqValue: 1, keywords: ['생명지킴이'] },
  { name: '이해충돌방지법', reqType: 'hours', reqValue: 1, keywords: ['이해충돌'] },
  { name: '긴급복지신고의무자교육', reqType: 'hours', reqValue: 1, keywords: ['긴급', '복지신고'] },
  { name: '정보공개교육', reqType: 'hours', reqValue: 1, keywords: ['정보공개'] },
  { name: '적극행정실천 교육', reqType: 'hours', reqValue: 1, keywords: ['적극행정'] },
  { name: '공직자안보교육', reqType: 'hours', reqValue: 1, keywords: ['안보'] },
  { name: '성별영향평가', reqType: 'hours', reqValue: 1, keywords: ['성별'] },
  { name: '성인지 감수성', reqType: 'hours', reqValue: 1, keywords: ['성인지'] },
];
