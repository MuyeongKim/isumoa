import type { ReqType } from '../../../shared/types.ts';

// 공공기관 법정교육 기본 목록 — 처음 실행할 때 한 번만 넣는다.
// 근거·기준은 참고용이다. 기관 담당자가 국가법령정보센터·기관 지침과 대조해 화면에서 고친다.
// keywords: 이수증의 과정명에서 찾을 단어. 비교할 때 띄어쓰기는 무시한다.
// "4대폭력"처럼 여러 교육에 함께 들어 있는 단어는 통합과정 1장으로 여러 교육을 인정하게 한다.

export interface CatalogEntry {
  code: string;
  name: string;
  category: string;
  legalBasis: string;
  reqType: ReqType;
  reqValue: number;
  keywords: string[];
  active: boolean;
}

const VIOLENCE_COMMON = ['4대폭력', '폭력예방통합', '통합폭력예방'];

export const PUBLIC_SECTOR_TRAININGS: CatalogEntry[] = [
  {
    code: 'sexual-harassment',
    name: '성희롱 예방교육',
    category: '폭력예방',
    legalBasis: '양성평등기본법 제31조, 남녀고용평등법 제13조',
    reqType: 'hours',
    reqValue: 1,
    keywords: ['성희롱', ...VIOLENCE_COMMON],
    active: true,
  },
  {
    code: 'sexual-violence',
    name: '성폭력 예방교육',
    category: '폭력예방',
    legalBasis: '성폭력방지 및 피해자보호 등에 관한 법률 제5조',
    reqType: 'hours',
    reqValue: 1,
    keywords: ['성폭력', ...VIOLENCE_COMMON],
    active: true,
  },
  {
    code: 'prostitution',
    name: '성매매 예방교육',
    category: '폭력예방',
    legalBasis: '성매매방지 및 피해자보호 등에 관한 법률 제5조',
    reqType: 'hours',
    reqValue: 1,
    keywords: ['성매매', ...VIOLENCE_COMMON],
    active: true,
  },
  {
    code: 'domestic-violence',
    name: '가정폭력 예방교육',
    category: '폭력예방',
    legalBasis: '가정폭력방지 및 피해자보호 등에 관한 법률 제4조의3',
    reqType: 'hours',
    reqValue: 1,
    keywords: ['가정폭력', ...VIOLENCE_COMMON],
    active: true,
  },
  {
    code: 'integrity',
    name: '청렴교육(부패방지교육)',
    category: '청렴',
    legalBasis: '부패방지 및 국민권익위원회의 설치와 운영에 관한 법률 제81조의2, 같은 법 시행령 제88조의2',
    reqType: 'hours',
    reqValue: 2,
    keywords: ['청렴', '부패방지', '반부패'],
    active: true,
  },
  {
    code: 'disability-awareness',
    name: '장애인 인식개선교육',
    category: '인식개선',
    legalBasis: '장애인복지법 제25조',
    reqType: 'hours',
    reqValue: 1,
    keywords: ['장애인식', '장애인인식', '장애인식개선'],
    active: true,
  },
  {
    code: 'privacy',
    name: '개인정보보호 교육',
    category: '정보보호',
    legalBasis: '개인정보 보호법 제28조',
    reqType: 'count',
    reqValue: 1,
    keywords: ['개인정보'],
    active: true,
  },
  {
    code: 'conflict-of-interest',
    name: '이해충돌방지·청탁금지 교육',
    category: '청렴',
    legalBasis: '공직자의 이해충돌 방지법, 부정청탁 및 금품등 수수의 금지에 관한 법률',
    reqType: 'count',
    reqValue: 1,
    keywords: ['이해충돌', '청탁금지', '부정청탁'],
    active: false,
  },
  {
    code: 'info-security',
    name: '정보보안 교육',
    category: '정보보호',
    legalBasis: '국가 정보보안 기본지침',
    reqType: 'count',
    reqValue: 1,
    keywords: ['정보보안', '사이버보안'],
    active: false,
  },
  {
    code: 'gender-sensitivity',
    name: '성인지 교육',
    category: '인식개선',
    legalBasis: '양성평등기본법 제18조',
    reqType: 'count',
    reqValue: 1,
    keywords: ['성인지'],
    active: false,
  },
  {
    code: 'fire-safety',
    name: '소방안전교육',
    category: '안전',
    legalBasis: '공공기관의 소방안전관리에 관한 규정 제14조',
    reqType: 'count',
    reqValue: 1,
    keywords: ['소방', '화재예방'],
    active: false,
  },
];
