import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONAL_TITLE, personalArchiveTitleError, personalTitle, personalTitleError } from '../../shared/exportTitles.ts';

describe('개인별 내보내기 제목 입력', () => {
  it('허용된 직원별 치환 항목과 일반 고정 제목을 받는다', () => {
    for (const title of [DEFAULT_PERSONAL_TITLE, '{연도}_{부서}_{성명}_{사번}', '기관 제출용', '../CON']) {
      expect(personalTitleError(title)).toBeNull();
    }
    expect(personalTitle('{연도}_{부서}_{성명}_{사번}', { 연도: '2026', 부서: '총무과', 성명: '가상직원', 사번: 'TEST-1' })).toBe('2026_총무과_가상직원_TEST-1');
  });

  it('지원하지 않는 항목은 거절하고 원래 제목으로 고치면 오류가 사라진다', () => {
    for (const title of ['{이름}_수료증', '{교육명}', '{ 성명 }', '{연도}_{성명}_{부서명}']) {
      expect(personalTitleError(title)).toContain('{성명}');
    }
    expect(personalTitleError('{이름}_수료증')).not.toBeNull();
    expect(personalTitleError(DEFAULT_PERSONAL_TITLE)).toBeNull();
  });

  it('API와 같이 제목 앞뒤 공백을 제외한 1~150자를 허용한다', () => {
    expect(personalTitleError(' \n ')).not.toBeNull();
    expect(personalTitleError('  ' + '가'.repeat(150) + '  ')).toBeNull();
    expect(personalTitleError('가'.repeat(151))).toContain('150');
    // 서버가 토큰으로 해석하지 않는 중괄호 리터럴까지 별도 제한하지 않는다.
    for (const title of ['{}', '문서 {', '{{성명}}']) expect(personalTitleError(title)).toBeNull();
  });

  it('ZIP 제목은 생략하거나 100자까지 고정 문자열로 쓰고 직원별 토큰으로 검사하지 않는다', () => {
    for (const title of ['', '   ', '기관제출', '{이름}_모음', '  ' + '나'.repeat(100) + '  ']) {
      expect(personalArchiveTitleError(title)).toBeNull();
    }
    expect(personalArchiveTitleError('나'.repeat(101))).toContain('100');
    expect(personalArchiveTitleError('기관제출')).toBeNull();
  });
});
