import { describe, expect, it } from 'vitest';
import { parseDateLoose } from '../../server/src/lib/dates.ts';

describe('parseDateLoose', () => {
  it.each([
    ['2026-05-14', '2026-05-14'],
    ['2026.5.14', '2026-05-14'],
    ['2026. 5. 14.', '2026-05-14'],
    ['2026/05/14', '2026-05-14'],
    ['2026년 5월 14일', '2026-05-14'],
    ['19850312', '1985-03-12'],
    ['850312', '1985-03-12'],
    ['010203', '2001-02-03'],
    ['85.03.12', '1985-03-12'],
  ])('%s → %s', (input, expected) => {
    expect(parseDateLoose(input)).toEqual({ value: expected, fromResidentNumber: false });
  });

  it('주민등록번호에서는 생년월일만 뽑고 표시한다', () => {
    expect(parseDateLoose('850312-1234567')).toEqual({ value: '1985-03-12', fromResidentNumber: true });
    expect(parseDateLoose('010203-3******')).toEqual({ value: '2001-02-03', fromResidentNumber: true });
    expect(parseDateLoose('8503122234567')).toEqual({ value: '1985-03-12', fromResidentNumber: true });
  });

  it('날짜 서식이 빠진 엑셀 일련번호를 읽는다', () => {
    expect(parseDateLoose('31118').value).toBe('1985-03-12');
  });

  it('Date 값은 그 컴퓨터의 날짜로 읽는다', () => {
    expect(parseDateLoose(new Date(1985, 2, 12)).value).toBe('1985-03-12');
  });

  it.each(['', '  ', '2026-13-01', '2026-02-30', '홍길동', '12', '19921399'])('"%s"은(는) 읽지 않는다', (input) => {
    expect(parseDateLoose(input).value).toBeNull();
  });
});
