import iconv from 'iconv-lite';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel.full.mjs';
import { formatLocalDate } from '../lib/dates.ts';

// 옛날 .xls 파일의 한글(코드페이지 949)을 읽기 위한 문자표
XLSX.set_cptable(cptable);

export interface RosterSheet {
  name: string;
  rows: string[][];
}

type FileKind = 'xlsx' | 'xls' | 'text';

function detectKind(buf: Buffer): FileKind {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  if (buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'xls';
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

function cellToText(value: unknown): string {
  if (value instanceof Date) return formatLocalDate(value);
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 엑셀(xlsx·xls)·CSV 파일을 시트별 문자열 표로 읽는다 */
export function readRosterFile(buf: Buffer): RosterSheet[] {
  const kind = detectKind(buf);
  const workbook =
    kind === 'text'
      ? XLSX.read(decodeText(buf), { type: 'string', raw: true })
      : XLSX.read(buf, { type: 'buffer', cellDates: true, codepage: 949 });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet['!ref']) return { name, rows: [] };
    // A1부터 읽고 빈 줄도 남겨서, 화면에 보이는 행 번호·열 이름이 엑셀과 같게 한다
    const range = XLSX.utils.decode_range(sheet['!ref']);
    range.s = { r: 0, c: 0 };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: true,
      range,
    });
    return { name, rows: rows.map((row) => row.map(cellToText)) };
  });
}
