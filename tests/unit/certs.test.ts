import { describe, expect, it } from 'vitest';
import type { Training } from '../../shared/types.ts';
import { matchEmployee, nameDistance, toJamo, type MatchableEmployee } from '../../server/src/certs/employeeMatcher.ts';
import { computeFlags, type FlagContext } from '../../server/src/certs/flags.ts';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import { computeStatus } from '../../server/src/certs/status.ts';
import { classifyTrainings, courseTitleKey, splitHours } from '../../server/src/certs/trainingClassifier.ts';

describe('이수증 글자 읽기', () => {
  it('항목 이름 사이를 띄워 쓴 양식을 읽는다', () => {
    const parsed = parseCertificateText(
      [
        '제 2026-00123 호',
        '수 료 증',
        '성          명 :  오호영',
        '생 년 월 일 :  1981. 10. 22.',
        '소          속 :  가람시 총무과',
        '과    정    명 :  2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)',
        '교 육 기 간 :  2026. 3. 2. ~ 2026. 3. 31.',
        '교 육 시 간 :  4시간',
        '위 사람은 본원에서 실시한 위 교육과정을',
        '성실히 이수하였기에 이 증서를 수여합니다.',
        '2026년 3월 31일',
        '가상인재개발원장',
      ].join('\n'),
    );
    expect(parsed).toMatchObject({
      personName: '오호영',
      personBirth: '1981-10-22',
      personDept: '가람시 총무과',
      courseTitle: '2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)',
      completedOn: '2026-03-31',
      hours: 4,
      certNo: '2026-00123',
      provider: '가상인재개발원',
      looksLikeCertificate: true,
    });
  });

  it('한 줄에 항목이 둘 있고 시간이 괄호 안에 있는 양식', () => {
    const parsed = parseCertificateText('교 육 이 수 증\n성 명   송주주    생년월일   1974-08-25\n교육명 : 2026년 공직자 청렴교육\n교육일 : 2026.05.20 (2시간)\n가상청렴연수원장');
    expect(parsed).toMatchObject({ personName: '송주주', personBirth: '1974-08-25', completedOn: '2026-05-20', hours: 2 });
  });

  it('OCR 잡음과 표 양식, 차시 단위를 다룬다', () => {
    const parsed = parseCertificateText('교육 이수증\nㅣ 이름           박똥이\n교육과정        ： 개인정보보호 기본교육\n이수시간   2차시\n이수일자   2026-07-01ㆍ');
    expect(parsed).toMatchObject({ personName: '박똥이', courseTitle: '개인정보보호 기본교육', hours: null, hoursText: '2차시', hoursInSessions: true, completedOn: '2026-07-01' });
  });

  it('문장 속 단어는 항목 이름으로 보지 않는다', () => {
    const parsed = parseCertificateText('위 사람은 위 교육과정을 이수하였기에 이 증서를 수여합니다.\n2026년 3월 31일');
    expect(parsed.courseTitle).toBeNull();
    expect(parsed.looksLikeCertificate).toBe(false);
  });

  it('OCR이 이름 뒤에 붙인 잡음 글자는 버리고, 글자마다 띄운 이름은 붙인다', () => {
    expect(parseCertificateText('성       명         : 조재재              개').personName).toBe('조재재');
    expect(parseCertificateText('성명 : 홍 길 동').personName).toBe('홍길동');
  });

  it('OCR이 망가뜨린 교육기간보다 발급일 줄을 믿는다', () => {
    const parsed = parseCertificateText('성 명 : 송주주\n교육기간  ＊ 2026. 3. 11 2026. 353:\n교육시간 : 4시간\n이수하였기에 이 증서를 수여합니다.\n2026년 3월 3일 __');
    expect(parsed.completedOn).toBe('2026-03-03');
  });

  it('60분은 1시간으로 바꾼다', () => {
    expect(parseCertificateText('이름  홍길동\n교육시간  60분\n이수일  2026.4.1').hours).toBe(1);
  });
});

describe('직원 찾기', () => {
  const base = { empNo: null, departmentId: 1, departmentName: '총무과', birthDate: null, status: 'active' as const };
  const employees: MatchableEmployee[] = [
    { ...base, id: 1, name: '오호영', nameKey: '오호영' },
    { ...base, id: 2, name: '김민준', nameKey: '김민준', departmentId: 2, departmentName: '정보통신과', birthDate: '1995-09-11' },
    { ...base, id: 3, name: '김민준', nameKey: '김민준', departmentId: 3, departmentName: '복지정책과', birthDate: '1975-04-24' },
    { ...base, id: 4, name: '박똠이', nameKey: '박똠이' },
  ];

  it('자모 단위로 비교한다', () => {
    expect(toJamo('\uD638')).toBe('\u1112\u1169'); // 호 → ㅎ + ㅗ (초성·중성)
    expect(nameDistance('오호영', '오후영')).toBe(1);
    expect(nameDistance('박똠이', '박똥이')).toBe(1);
    expect(nameDistance('오호영', '김민준')).toBeGreaterThan(2);
  });

  it('OCR로 잘못 읽은 이름을 비슷한 이름으로 찾는다', () => {
    expect(matchEmployee({ name: '오후영', birth: null, dept: null }, employees, null)).toMatchObject({ employeeId: 1, method: 'similar' });
  });

  it('동명이인은 생년월일이나 소속으로 가린다', () => {
    expect(matchEmployee({ name: '김민준', birth: '1975-04-24', dept: null }, employees, null).employeeId).toBe(3);
    expect(matchEmployee({ name: '김민준', birth: null, dept: '가람시 정보통신과' }, employees, null).employeeId).toBe(2);
    expect(matchEmployee({ name: '김민준', birth: null, dept: null }, employees, [3]).employeeId).toBe(3);
    const ambiguous = matchEmployee({ name: '김민준', birth: null, dept: null }, employees, null);
    expect(ambiguous.employeeId).toBeNull();
    expect(ambiguous.candidates).toHaveLength(2);
  });

  it('이름 항목을 못 읽었으면 글 속에서 명단의 이름을 찾는다', () => {
    const result = matchEmployee({ name: null, birth: null, dept: null, text: '교육 이수증\n박똠이\n가람시 총무과' }, employees, null);
    expect(result).toMatchObject({ employeeId: 4, method: 'text' });
    // 두 글자 이름처럼 짧은 이름이 다른 낱말 속에 들어 있는 것은 이름으로 보지 않는다
    const short = [{ ...employees[0], id: 9, name: '이수', nameKey: '이수' }];
    expect(matchEmployee({ name: null, birth: null, dept: null, text: '교육 이수증' }, short, null).employeeId).toBeNull();
  });

  it('생년월일이 모두 다르면 자동으로 고르지 않는다', () => {
    expect(matchEmployee({ name: '김민준', birth: '2000-01-01', dept: null }, employees, null).employeeId).toBeNull();
  });
});

describe('교육 분류', () => {
  const trainings = [
    { id: 1, name: '성희롱 예방교육', keywords: ['성희롱', '4대폭력', '폭력예방통합'], applicable: true },
    { id: 2, name: '성폭력 예방교육', keywords: ['성폭력', '4대폭력', '폭력예방통합'], applicable: true },
    { id: 3, name: '가정폭력 예방교육', keywords: ['가정폭력', '4대폭력', '폭력예방통합'], applicable: true },
    { id: 5, name: '청렴교육', keywords: ['청렴'], applicable: true },
    { id: 8, name: '이해충돌방지', keywords: ['이해충돌'], applicable: false },
  ];

  it('통합과정 한 장으로 여러 교육을 정한다', () => {
    const result = classifyTrainings('2026년 폭력예방 통합교육', '', trainings, new Map());
    expect(result).toMatchObject({ trainingIds: [1, 2, 3], source: 'keyword' });
  });

  it('"가정폭력"을 "성폭력"으로 보지 않는다', () => {
    expect(classifyTrainings('가정폭력 예방교육', '', trainings, new Map()).trainingIds).toEqual([3]);
  });

  it('확정하며 쌓인 매핑을 먼저 쓴다 (연도가 달라도 같은 과정)', () => {
    expect(courseTitleKey('2026년 공직자 청렴교육')).toBe(courseTitleKey('2027년 공직자 청렴 교육'));
    const learned = new Map([[courseTitleKey('공직윤리 특강'), [5]]]);
    expect(classifyTrainings('2026년 공직윤리 특강', '', trainings, learned)).toMatchObject({ trainingIds: [5], source: 'learned' });
  });

  it('사용하지 않는 교육은 따로 알려 준다', () => {
    expect(classifyTrainings('이해충돌방지법의 이해', '', trainings, new Map())).toMatchObject({ trainingIds: [], inactiveMatches: ['이해충돌방지'] });
  });

  it('통합과정 시간은 교육 수로 나눈다', () => {
    expect(splitHours(4, 4)).toBe(1);
    expect(splitHours(null, 2)).toBeNull();
  });
});

describe('확인할 점', () => {
  const ctx: FlagContext = {
    status: 'draft',
    personName: '오후영',
    personBirth: null,
    personDept: null,
    employee: { name: '오호영', departmentId: 1, departmentName: '총무과', birthDate: null, status: 'active' },
    ambiguousCount: 0,
    trainings: [{ name: '청렴교육', reqType: 'hours' }],
    inactiveMatches: [],
    completedOn: '2025-11-20',
    hours: null,
    hoursText: null,
    batchYear: 2026,
    year: 2025,
    looksLikeCertificate: true,
    route: 'ocr',
    duplicateIds: [],
    scope: [2],
    today: '2026-10-23',
  };

  it('경고와 확정을 막는 오류를 나눈다', () => {
    const codes = computeFlags(ctx).map((f) => `${f.level}:${f.code}`);
    expect(codes).toEqual(['warning:name-differs', 'error:out-of-scope', 'warning:year-differs', 'warning:no-hours', 'info:ocr']);
  });

  it('직원·교육·이수일이 없으면 오류', () => {
    const codes = computeFlags({ ...ctx, employee: null, trainings: [], completedOn: null, scope: null }).map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['no-employee', 'no-training', 'no-date']));
  });
});

describe('이수 판정', () => {
  const training = (id: number, reqType: 'hours' | 'count', reqValue: number): Training => ({
    id,
    code: `t${id}`,
    name: `교육${id}`,
    category: null,
    legalBasis: null,
    reqType,
    reqValue,
    keywords: [],
    fromYear: null,
    toYear: null,
    active: true,
    sortOrder: id,
    note: null,
  });
  const employee = (id: number, status: 'active' | 'leave' | 'retired' = 'active') => ({ id, empNo: null, name: `직원${id}`, departmentId: 1, departmentName: '총무과', status });

  it('시간 기준은 인정 시간을 더하고, 횟수 기준은 장 수를 센다', () => {
    const report = computeStatus({
      year: 2026,
      trainings: [training(1, 'hours', 2), training(2, 'count', 1)],
      employees: [employee(1), employee(2), employee(3, 'leave'), employee(4, 'retired')],
      credits: [
        { employeeId: 1, trainingId: 1, certificateId: 10, creditedHours: 1 },
        { employeeId: 1, trainingId: 1, certificateId: 11, creditedHours: 1 },
        { employeeId: 2, trainingId: 1, certificateId: 12, creditedHours: 1 },
        { employeeId: 2, trainingId: 2, certificateId: 13, creditedHours: null },
      ],
      exemptions: [{ employeeId: 1, trainingId: 2, reason: '신규 임용' }],
    });
    expect(report.rows.map((r) => r.employeeId)).toEqual([1, 2, 3]);
    expect(report.rows[0].cells[1]).toMatchObject({ state: 'done', hours: 2, count: 2 });
    expect(report.rows[0].cells[2]).toMatchObject({ state: 'exempt', note: '신규 임용' });
    expect(report.rows[1].cells[1]).toMatchObject({ state: 'partial', note: '1시간 / 연 2시간' });
    expect(report.rows[1].cells[2].state).toBe('done');
    expect(report.rows[2].cells[1]).toMatchObject({ state: 'exempt', note: '휴직' });
    expect(report.summary[0]).toMatchObject({ target: 2, done: 1, partial: 1, exempt: 1, rate: 0.5 });
  });
});
