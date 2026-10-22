// 명단·이수증에 적힌 여러 형태의 날짜를 YYYY-MM-DD로 바꾼다.

export interface ParsedDate {
  /** YYYY-MM-DD, 읽지 못하면 null */
  value: string | null;
  /** 주민등록번호 형태에서 생년월일만 뽑아냈을 때 true — 나머지 자리는 버린다 */
  fromResidentNumber: boolean;
}

const EMPTY: ParsedDate = { value: null, fromResidentNumber: false };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function build(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 두 자리 연도: 올해 끝 두 자리보다 크면 1900년대로 본다 (생년월일 기준) */
function expandYear(yy: number): number {
  const current = new Date().getFullYear() % 100;
  return yy > current ? 1900 + yy : 2000 + yy;
}

/** 엑셀 날짜 일련번호(1900 날짜 체계) → 날짜 */
function fromExcelSerial(serial: number): string | null {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return build(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 엑셀이 만든 Date는 그 컴퓨터의 자정 기준이라 지역 시간으로 읽는다 */
export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateLoose(input: unknown): ParsedDate {
  if (input === null || input === undefined) return EMPTY;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? EMPTY : { value: formatLocalDate(input), fromResidentNumber: false };
  }

  const text = String(input).normalize('NFC').trim();
  if (text === '') return EMPTY;
  const compact = text.replace(/\s+/g, '');

  // 주민등록번호: 850312-1234567, 8503121234567, 850312-1******
  const rrn = /^(\d{2})(\d{2})(\d{2})-?([0-9])[\d*xX]{0,6}$/.exec(compact);
  if (rrn && compact.length >= 7 && /[-*xX]|^\d{13}$/.test(compact)) {
    const centuryDigit = Number(rrn[4]);
    const century = [1, 2, 5, 6].includes(centuryDigit) ? 1900 : [3, 4, 7, 8].includes(centuryDigit) ? 2000 : 1800;
    return {
      value: build(century + Number(rrn[1]), Number(rrn[2]), Number(rrn[3])),
      fromResidentNumber: true,
    };
  }

  // 2026-05-14, 2026.05.14, 2026/5/14, 2026. 5. 14., 2026년 5월 14일
  const ymd = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?$/.exec(text);
  if (ymd) return { value: build(Number(ymd[1]), Number(ymd[2]), Number(ymd[3])), fromResidentNumber: false };

  // 19850312
  if (/^\d{8}$/.test(compact)) {
    return {
      value: build(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)), Number(compact.slice(6, 8))),
      fromResidentNumber: false,
    };
  }

  // 850312 (YYMMDD)
  if (/^\d{6}$/.test(compact)) {
    return {
      value: build(expandYear(Number(compact.slice(0, 2))), Number(compact.slice(2, 4)), Number(compact.slice(4, 6))),
      fromResidentNumber: false,
    };
  }

  // 85.03.12, 85-3-12
  const yymd = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(compact);
  if (yymd) {
    return {
      value: build(expandYear(Number(yymd[1])), Number(yymd[2]), Number(yymd[3])),
      fromResidentNumber: false,
    };
  }

  // 날짜 서식이 빠진 엑셀 칸: 일련번호 (10000 ≈ 1927년, 60000 ≈ 2064년)
  if (/^\d{5}(\.\d+)?$/.test(compact)) {
    const serial = Number(compact);
    if (serial >= 10000 && serial <= 60000) return { value: fromExcelSerial(Math.floor(serial)), fromResidentNumber: false };
  }

  return EMPTY;
}
