// 시연·테스트용 가상 직원 (실존 인물 아님). 명단·이수증 샘플이 같은 사람들을 쓰도록 한곳에 둔다.

export const ORG = '가람시';

/** 실행할 때마다 같은 명단이 나오도록 고정된 난수 */
function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const SYLLABLES = ['민', '서', '지', '현', '우', '준', '수', '영', '은', '혜', '진', '호', '성', '태', '윤', '하', '도', '연', '경', '재', '희', '주', '원', '가', '온', '람', '빈', '솔', '아', '결'];
export const DEPARTMENTS = ['기획예산과', '총무과', '재무과', '민원봉사과', '복지정책과', '환경과', '도시계획과', '정보통신과'];
const GRADES = ['행정5급', '행정6급', '행정6급', '행정7급', '행정7급', '행정8급', '행정9급', '전산7급', '시설8급'];

export interface Person {
  empNo: string;
  name: string;
  department: string;
  grade: string;
  type: string;
  birth: Date;
  status: string;
  hired: Date;
}

export function makePeople(count = 120): Person[] {
  const random = seededRandom(20261022);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
  const used = new Set<string>();
  const people: Person[] = [];
  for (let i = 0; i < count; i++) {
    let name = '';
    do name = pick(SURNAMES) + pick(SYLLABLES) + pick(SYLLABLES);
    while (used.has(name));
    used.add(name);
    const hiredYear = 1995 + Math.floor(random() * 30);
    const type = random() < 0.12 ? '공무직' : random() < 0.05 ? '기간제' : '일반직';
    people.push({
      empNo: `${hiredYear}${String(i + 1).padStart(3, '0')}`,
      name,
      department: DEPARTMENTS[i % DEPARTMENTS.length],
      grade: type === '일반직' ? pick(GRADES) : type,
      type,
      birth: new Date(1966 + Math.floor(random() * 35), Math.floor(random() * 12), 1 + Math.floor(random() * 28)),
      status: '재직',
      hired: new Date(hiredYear, Math.floor(random() * 12), 1 + Math.floor(random() * 28)),
    });
  }
  // 시연용 사례: 동명이인(부서·생년월일이 다름), 휴직, 파견, CP949 확장 한글 이름
  people[7] = { ...people[7], name: '김민준' };
  people[20] = { ...people[20], name: '김민준' };
  people[11].status = '휴직';
  people[15].status = '파견';
  people[33].name = '박똠이';
  return people;
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
