import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';

// 인사 명단 파일을 시트별 문자열 표로 읽는다.
//   .xlsx          ExcelJS
//   .csv · 탭 텍스트   직접 읽는다 (한글 윈도우의 CP949도)
//   확장자만 .xls인 HTML 표   인사 시스템이 이렇게 내보내는 경우가 많아 직접 읽는다
//   진짜 옛 엑셀(.xls)·암호 걸린 파일   읽지 않고 .xlsx로 저장하는 방법을 알려 준다

export interface RosterSheet {
  name: string;
  rows: string[][];
}

/** 사용자에게 그대로 보여 줄 수 있는 "파일을 읽지 못한 이유" */
export class RosterFileError extends Error {}

const SAVE_AS_XLSX = '엑셀에서 파일을 열어 "다른 이름으로 저장"을 누르고 파일 형식을 "Excel 통합 문서(.xlsx)"로 바꿔 다시 올려 주세요.';

type FileKind = 'xlsx' | 'ole' | 'text';

function detectKind(buf: Buffer): FileKind {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'ole'; // 옛 .xls, 암호 건 엑셀
  return 'text'; // CSV, 탭 구분 텍스트, 확장자만 .xls인 HTML 표
}

/**
 * 텍스트 파일의 인코딩을 판단해 문자열로 바꾼다.
 * UTF-8로 읽히지 않으면 한글 윈도우 기본값인 CP949로 읽는다.
 * (Node의 TextDecoder('euc-kr')는 '똠', '햏' 같은 확장 한글을 깨뜨리므로 iconv-lite를 쓴다)
 */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return iconv.decode(buf, 'cp949');
  }
}

function tidy(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** 엑셀 칸 값을 보이는 글자로. 날짜 칸은 YYYY-MM-DD (엑셀 날짜는 시간대 없는 값이라 UTC 기준으로 읽는다) */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return tidy(value.richText.map((r) => r.text).join(''));
    if ('formula' in value || 'sharedFormula' in value) return cellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('hyperlink' in value) return tidy(String(value.text ?? ''));
    return ''; // 오류 값 등
  }
  return tidy(String(value));
}

async function readXlsx(buf: Buffer): Promise<RosterSheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new RosterFileError(`엑셀 파일을 읽지 못했습니다. 파일이 깨졌거나 암호가 걸려 있을 수 있습니다. ${SAVE_AS_XLSX}`);
  }
  return workbook.worksheets
    .filter((sheet) => sheet.state !== 'veryHidden')
    .map((sheet) => {
      // 값이 있는 칸만 모은다 (서식만 칠해 둔 아래쪽 빈 줄이 수십만 줄이어도 느려지지 않게)
      const cells = new Map<number, Map<number, string>>();
      let lastRow = 0;
      let lastCol = 0;
      sheet.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          if (cell.type === ExcelJS.ValueType.Merge) return; // 합친 칸은 왼쪽 위 칸에만 글자가 있다
          const text = cellText(cell.value);
          if (text === '') return;
          if (!cells.has(r)) cells.set(r, new Map());
          cells.get(r)!.set(c, text);
          lastRow = Math.max(lastRow, r);
          lastCol = Math.max(lastCol, c);
        });
      });
      // A1부터 읽고 빈 줄도 남겨서, 화면에 보이는 행 번호·열 이름이 엑셀과 같게 한다
      const rows = Array.from({ length: lastRow }, (_, r) => Array.from({ length: lastCol }, (_, c) => cells.get(r + 1)?.get(c + 1) ?? ''));
      return { name: sheet.name, rows };
    });
}

/** 구분 기호를 첫 줄에서 고른다: 탭 > 쉼표 > 세미콜론 중 가장 많은 것 */
function pickDelimiter(text: string): string {
  const first = text.split(/\r\n|\n|\r/).find((line) => line.trim() !== '') ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  const best = [',', '\t', ';'].map((ch) => [ch, count(ch)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

function squareUp(rows: string[][]): string[][] {
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => Array.from({ length: width }, (_, i) => tidy(r[i] ?? '')));
}

/** 따옴표("...", 안의 "" = 따옴표 하나, 안의 줄바꿈·구분 기호 허용)를 지키는 CSV·탭 텍스트 읽기 */
export function parseDelimited(text: string): string[][] {
  const delimiter = pickDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return squareUp(rows);
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function htmlText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return ENTITIES[String(name).toLowerCase()] ?? m;
    });
}

/** 확장자만 .xls인 HTML 파일의 표들을 읽는다 (표 하나가 시트 하나) */
export function parseHtmlTables(html: string): RosterSheet[] {
  const sheets: RosterSheet[] = [];
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: string[][] = [];
    for (const tr of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const row: string[] = [];
      for (const td of tr[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
        row.push(htmlText(td[2]));
        const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[1])?.[1] ?? 1);
        for (let k = 1; k < Math.min(span, 50); k++) row.push(''); // 합친 칸은 왼쪽 칸에만 글자
      }
      rows.push(row);
    }
    if (rows.length > 0) sheets.push({ name: `Sheet${sheets.length + 1}`, rows: squareUp(rows) });
  }
  return sheets;
}

function readText(buf: Buffer): RosterSheet[] {
  const text = decodeText(buf);
  if (text.includes('\u0000')) throw new RosterFileError('엑셀(.xlsx)이나 CSV 파일이 아닌 것 같습니다. 파일을 확인해 주세요.');
  if (/^\s*(<\?xml|<!doctype|<html|<table)/i.test(text)) {
    if (/<Workbook\b/i.test(text)) throw new RosterFileError(`XML 스프레드시트 형식은 읽지 못합니다. ${SAVE_AS_XLSX}`);
    const sheets = parseHtmlTables(text);
    if (sheets.length === 0) throw new RosterFileError('파일에서 표를 찾지 못했습니다. 인사 시스템의 엑셀 내려받기 파일인지 확인해 주세요.');
    return sheets;
  }
  return [{ name: 'Sheet1', rows: parseDelimited(text) }];
}

/** 엑셀(.xlsx)·CSV·HTML 표 파일을 시트별 문자열 표로 읽는다. 읽을 수 없으면 이유를 담은 RosterFileError */
export async function readRosterFile(buf: Buffer): Promise<RosterSheet[]> {
  switch (detectKind(buf)) {
    case 'xlsx':
      return readXlsx(buf);
    case 'ole':
      throw new RosterFileError(`옛 엑셀(.xls) 형식이거나 암호가 걸린 파일은 읽지 못합니다. ${SAVE_AS_XLSX}`);
    case 'text':
      return readText(buf);
  }
}
