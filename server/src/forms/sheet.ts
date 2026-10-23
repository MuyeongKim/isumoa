import type ExcelJS from 'exceljs';

// 양식 시트를 다루는 작은 도구들: 열 이름, 합친 칸, 칸 글자, 수식 안의 칸 주소 옮기기.

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function columnLetter(col: number): string {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** 시트의 합친 칸 목록 (ExcelJS가 공개 API로 내주지 않아 내부 값을 읽는다) */
export function sheetMerges(ws: ExcelJS.Worksheet): CellRange[] {
  const merges = (ws as unknown as { _merges: Record<string, CellRange> })._merges ?? {};
  return Object.values(merges).map(({ top, left, bottom, right }) => ({ top, left, bottom, right }));
}

/** 칸에 보이는 글자. 합친 칸의 나머지 칸은 '' (글자는 맨 왼쪽 위 칸에만 있다) */
export function cellText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const cell = ws.getCell(row, col);
  if (cell.isMerged && cell.master.address !== cell.address) return '';
  return valueText(cell.value);
}

/** 합친 칸이면 그 칸의 글자 (머리글처럼 여러 칸에 걸친 이름을 읽을 때) */
export function masterText(ws: ExcelJS.Worksheet, row: number, col: number): string {
  const cell = ws.getCell(row, col);
  return valueText(cell.isMerged ? cell.master.value : cell.value);
}

export function valueText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('').trim();
    if ('formula' in value || 'sharedFormula' in value) return valueText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text).trim();
    if ('error' in value) return '';
  }
  return String(value).trim();
}

export function isFormulaCell(cell: ExcelJS.Cell): boolean {
  const v = cell.value;
  return typeof v === 'object' && v !== null && ('formula' in v || 'sharedFormula' in v);
}

/** 칸 서식이 날짜인지 ("yyyy-mm-dd" 등). 따옴표 글자와 [색] 같은 꾸밈은 빼고 본다 */
export function isDateFormat(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  return /[yd]/i.test(numFmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
}

// 수식·범위 글자 안의 칸 주소(범위면 끝 주소까지 한 번에). 따옴표 문자열은 건너뛰고,
// 다른 시트를 가리키는 주소(Other!A7:A9)는 끝 주소까지 그대로 둔다.
// LOG10( 같은 함수 이름을 주소로 보지 않도록 뒤에 '('가 오면 뺀다.
const CELL = String.raw`(\$?)\b([A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])`;
const REF = new RegExp(
  String.raw`("(?:[^"]|"")*")|((?:'(?:[^']|'')+'|[A-Za-z_가-힣][A-Za-z0-9_가-힣.]*)!)?${CELL}(?::${CELL})?`,
  'g',
);

function sheetOf(prefix: string): string {
  return prefix.slice(0, -1).replace(/^'(.*)'$/, '$1').replaceAll("''", "'");
}

/** 주소의 행 번호를 fn으로 바꾼다 (fn(행, 절대주소인지)) */
export function mapRows(text: string, sheetName: string, fn: (row: number, absolute: boolean) => number): string {
  return text.replace(REF, (match, ...g: (string | undefined)[]) => {
    const [str, sheet, c1Abs, c1, r1Abs, r1, c2Abs, c2, r2Abs, r2] = g;
    if (str) return match;
    if (sheet && sheetOf(sheet) !== sheetName) return match;
    const first = `${c1Abs}${c1}${r1Abs}${fn(Number(r1), r1Abs === '$')}`;
    const second = c2 ? `:${c2Abs}${c2}${r2Abs}${fn(Number(r2), r2Abs === '$')}` : '';
    return `${sheet ?? ''}${first}${second}`;
  });
}

/** after 행 아래에 by 줄을 끼웠을 때: 그보다 아래 행을 가리키던 주소를 밀어 준다 (엑셀에서 줄을 끼울 때와 같다) */
export function shiftAfter(text: string, sheetName: string, after: number, by: number): string {
  return mapRows(text, sheetName, (row) => (row > after ? row + by : row));
}

/** 수식을 from 행에서 to 행으로 복사할 때: 상대 주소만 옮긴다 (엑셀의 "아래로 채우기") */
export function translateRows(formula: string, sheetName: string, from: number, to: number): string {
  return mapRows(formula, sheetName, (row, absolute) => (absolute ? row : row + (to - from)));
}

/** 다른 시트를 가리키는 수식인지 */
export function refersOtherSheet(formula: string, sheetName: string): boolean {
  return [...formula.matchAll(REF)].some((m) => m[2] && sheetOf(m[2]) !== sheetName);
}
