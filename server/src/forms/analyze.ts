import { isStatutoryTemplate } from './statutoryTemplate.ts';
import ExcelJS from 'exceljs';
import { HEADER_WORDS, normalizeHeader } from '../../../shared/rosterColumns.ts';
import { shortTrainingName } from '../../../shared/trainingNames.ts';
import type { FormColumn, FormColumnFill, FormLayout, FormPersonField, FormTrainingFormat, Training } from '../../../shared/types.ts';
import { badRequest } from '../lib/errors.ts';
import { cellText, columnLetter, isFormulaCell, masterText, refersOtherSheet, sheetMerges, type CellRange } from './sheet.ts';

// 올린 제출 양식(엑셀)에서 자리를 찾는다: 머리글 줄, 사람을 쓸 줄, 합계·서명란, 열마다 넣을 내용.
// 흔한 명단형 양식(한 사람 = 한 줄)을 기준으로 하고, 못 맞춘 것은 화면에서 사용자가 고친다.

export interface AnalyzeOptions {
  sheetName?: string;
  headerFirst?: number;
  headerLast?: number;
  dataFirst?: number;
  footerRow?: number;
}

export interface AnalyzedForm {
  workbookKind: 'generic' | 'statutory16';
  sheets: string[];
  layout: FormLayout;
  columns: FormColumn[];
  placeholders: string[];
  warnings: string[];
  rows: { row: number; cells: string[] }[];
}

export const PLACEHOLDERS = ['기관명', '부서명', '연도', '작성일', '작성자'] as const;
const PLACEHOLDER_RE = new RegExp(`\\{(${PLACEHOLDERS.join('|')})\\}`, 'g');

const SEQ_WORDS = ['연번', '순번', '번호', 'no', '순', '일련번호'];
const PERSON_WORDS: [FormPersonField, string[]][] = [
  ['seq', SEQ_WORDS],
  ['name', HEADER_WORDS.name.exact],
  ['organization', ['소속', '소속기관', '기관명']],
  ['department', HEADER_WORDS.department.exact],
  ['position', HEADER_WORDS.position.exact],
  ['empNo', HEADER_WORDS.empNo.exact],
  ['birthDate', HEADER_WORDS.birthDate.exact],
  ['empType', HEADER_WORDS.empType.exact],
];
const KNOWN_HEADER = new Set([...PERSON_WORDS.flatMap(([, words]) => words), '비고']);
const FOOTER_EXACT = new Set(['계', '합계', '소계', '총계', '합']);
const FOOTER_WORDS = ['위와같이', '작성자', '확인자', '담당자', '결재', '제출합니다', '붙임'];
const SCAN_ROWS = 2000;
const MAX_FILE = 5 * 1024 * 1024;

/** .xlsx만 받는다. 다른 형식은 고치는 방법을 알려 준다 */
export function assertXlsx(buffer: Buffer, fileName: string) {
  if (buffer.length > MAX_FILE) throw badRequest('양식 파일이 5MB를 넘습니다. 그림을 빼거나 빈 양식만 남겨 다시 올려 주세요.');
  if (/\.xlsm$/i.test(fileName)) throw badRequest('매크로가 든 엑셀(.xlsm)은 받지 않습니다. 엑셀에서 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 저장해 올려 주세요.');
  if (buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) {
    throw badRequest('옛 엑셀(.xls) 형식이거나 암호가 걸린 파일입니다. 엑셀에서 암호를 풀고 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 저장해 올려 주세요.');
  }
  if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw badRequest('엑셀(.xlsx) 파일만 올릴 수 있습니다.');
}

export async function loadWorkbook(buffer: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(buffer) as unknown as ArrayBuffer);
  } catch {
    throw badRequest('엑셀 파일을 읽지 못했습니다. 엑셀에서 열어 "다른 이름으로 저장 → Excel 통합 문서(.xlsx)"로 다시 저장해 올려 주세요.');
  }
  return wb;
}

function key(text: string): string {
  return normalizeHeader(text);
}

/** 앞 20줄 중 사람 항목 머리글(성명·소속 등)이 2개 이상인 첫 줄 */
function detectHeaderRow(ws: ExcelJS.Worksheet, lastCol: number): number | null {
  for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
    let known = 0;
    for (let c = 1; c <= lastCol; c++) if (KNOWN_HEADER.has(key(cellText(ws, r, c)))) known++;
    if (known >= 2) return r;
  }
  return null;
}

/** 머리글 줄에서 시작하는 합친 칸이 아래로 내려가면 그 줄까지 머리글로 본다. 가로로 합친 칸(큰 제목) 아래에 작은 제목이 있으면 두 줄 머리글 */
function detectHeaderLast(ws: ExcelJS.Worksheet, merges: CellRange[], first: number): number {
  let last = first;
  for (const m of merges) if (m.top === first && m.bottom > last) last = m.bottom;
  if (last === first) {
    const wide = merges.filter((m) => m.top === first && m.bottom === first && m.right > m.left);
    if (wide.some((m) => Array.from({ length: m.right - m.left + 1 }, (_, i) => cellText(ws, first + 1, m.left + i)).some(Boolean))) last = first + 1;
  }
  return Math.min(last, first + 3);
}

/** 표처럼 테두리가 그려진 줄인지 (표 폭의 절반 넘는 칸에 테두리가 있으면) */
function isTableRow(ws: ExcelJS.Worksheet, row: number, left: number, right: number): boolean {
  let bordered = 0;
  for (let c = left; c <= right; c++) {
    const b = ws.getCell(row, c).border;
    if (b && (b.top || b.bottom || b.left || b.right)) bordered++;
  }
  return bordered * 2 > right - left + 1;
}

function isFooterRow(ws: ExcelJS.Worksheet, merges: CellRange[], row: number, left: number, right: number): boolean {
  for (let c = left; c <= right; c++) {
    const text = key(cellText(ws, row, c));
    if (!text) continue;
    if (FOOTER_EXACT.has(text) || FOOTER_WORDS.some((w) => text.includes(w))) return true;
  }
  const width = right - left + 1;
  return merges.some((m) => m.top === row && m.right - m.left + 1 >= Math.ceil(width / 2) && m.right >= left && m.left <= right);
}

/** 사람을 다 쓴 뒤 이어지는 합계·서명란의 첫 줄 (그 위까지가 미리 그려 둔 빈 줄) */
function detectFooterRow(ws: ExcelJS.Worksheet, merges: CellRange[], dataFirst: number, left: number, right: number, sequenceColumns: number[]): number {
  const last = Math.min(ws.rowCount, dataFirst + SCAN_ROWS);
  for (let r = dataFirst; r <= last; r++) {
    // 테두리 없는 양식도 연번만 1, 2, 3… 미리 적힌 줄은 사람을 쓸 자리다.
    // 다른 칸에 글자가 있거나 연번이 이어지지 않으면 임의로 데이터 영역을 늘리지 않는다.
    const sequenceOnly = sequenceColumns.some(col => cellText(ws, r, col).trim() === String(r - dataFirst + 1)
      && Array.from({ length: right - left + 1 }, (_, i) => left + i).every(c => c === col || !cellText(ws, r, c).trim()));
    if (isFooterRow(ws, merges, r, left, right) || (!isTableRow(ws, r, left, right) && !sequenceOnly)) return r;
  }
  return last + 1;
}

interface TrainingMatch {
  training: Training | null;
  ambiguous: boolean;
}

/** 머리글을 교육 이름·찾을 단어와 맞춘다. 가장 길게 맞은 교육 하나를 고르고, 여럿이 같으면 고르지 않는다 */
export function matchTraining(label: string, trainings: Training[]): TrainingMatch {
  const k = key(label);
  if (!k) return { training: null, ambiguous: false };
  let best = 0;
  let found: Training[] = [];
  for (const t of trainings) {
    const names = [t.name, shortTrainingName(t.name), ...t.keywords].map(key).filter((n) => n.length >= 2);
    const score = Math.max(0, ...names.filter((n) => k.includes(n)).map((n) => n.length));
    if (score === 0) continue;
    if (score > best) {
      best = score;
      found = [t];
    } else if (score === best) found.push(t);
  }
  return found.length === 1 ? { training: found[0], ambiguous: false } : { training: null, ambiguous: found.length > 1 };
}

/** 교육 열의 아래 칸 이름으로 넣을 형식을 정한다 */
function trainingFormat(label: string): FormTrainingFormat | null {
  const k = key(label);
  if (/수료증번호|증서번호|이수증번호|이수번호/.test(k)) return 'certNo';
  if (/이수일|일자|날짜|일시|수료일|완료일/.test(k)) return 'date';
  if (k.includes('시간')) return 'hours';
  if (/과정|교육명/.test(k)) return 'course';
  if (k.includes('기관')) return 'provider';
  if (k.includes('상태')) return 'status';
  if (/여부|결과|이수|완료|수료/.test(k)) return 'mark';
  return null;
}

function personField(label: string): FormPersonField | null {
  const k = key(label);
  return PERSON_WORDS.find(([, words]) => words.includes(k))?.[0] ?? null;
}

interface GuessContext {
  trainings: Training[];
  /** 제목 줄에서 찾은 교육 (양식 하나가 교육 하나일 때: "성희롱 예방교육 이수 현황") */
  titleTraining: Training | null;
}

function guessFill(parts: string[], ctx: GuessContext, warnings: string[]): FormColumnFill {
  const leaf = parts.at(-1) ?? '';
  const person = personField(leaf) ?? (parts.length > 1 ? personField(parts[0]) : null);
  if (person) return { kind: 'person', field: person };
  if (/미이수(교육|과목)?$/.test(key(leaf)) && !trainingFormat(parts[0] ?? '')) return { kind: 'missing' };

  // 위 칸(큰 제목)에서 교육을 찾고, 없으면 칸 이름 전체에서
  let match = matchTraining(parts[0] ?? '', ctx.trainings);
  if (!match.training && !match.ambiguous && parts.length > 1) match = matchTraining(parts.join(' '), ctx.trainings);
  if (match.ambiguous) {
    warnings.push(`'${parts.join(' › ')}' 열은 여러 교육에 해당할 수 있어 비워 두었습니다. 넣을 교육을 골라 주세요.`);
    return { kind: 'none' };
  }
  const training = match.training ?? ctx.titleTraining;
  const format = trainingFormat(leaf) ?? (match.training ? 'mark' : null);
  if (training && format) return { kind: 'training', trainingId: training.id, format };
  return { kind: 'none' };
}

export async function analyzeForm(buffer: Buffer | Uint8Array, trainings: Training[], options: AnalyzeOptions = {}): Promise<AnalyzedForm> {
  const wb = await loadWorkbook(buffer);
  const sheets = wb.worksheets.filter((s) => s.state !== 'hidden' && s.state !== 'veryHidden');
  if (sheets.length === 0) throw badRequest('양식에 보이는 시트가 없습니다.');
  const warnings: string[] = [];

  // 시트: 고른 시트, 아니면 머리글을 찾은 첫 시트
  const width = (s: ExcelJS.Worksheet) => Math.min(Math.max(s.columnCount, 1), 60);
  const ws =
    (options.sheetName ? sheets.find((s) => s.name === options.sheetName) : sheets.find((s) => detectHeaderRow(s, width(s)) !== null)) ?? sheets[0];
  const merges = sheetMerges(ws);
  const lastCol = width(ws);

  const detected = detectHeaderRow(ws, lastCol);
  if (detected === null && !options.headerFirst) warnings.push('성명·소속 같은 머리글 줄을 찾지 못했습니다. 아래에서 머리글 줄 번호를 정해 주세요.');
  const headerFirst = options.headerFirst ?? detected ?? 1;
  const headerLast = Math.max(headerFirst, options.headerLast ?? detectHeaderLast(ws, merges, headerFirst));

  // 표의 열: 머리글에 글자가 있는 열. 가로로 합친 머리글의 나머지 칸(모든 머리글 줄에서 왼쪽 칸에 묶인 칸)은 뺀다
  const tableCols: number[] = [];
  for (let c = 1; c <= lastCol; c++) {
    let hasText = false;
    let alwaysSlave = true;
    for (let r = headerFirst; r <= headerLast; r++) {
      const cell = ws.getCell(r, c);
      if (masterText(ws, r, c)) hasText = true;
      if (!(cell.isMerged && Number(cell.master.col) < c)) alwaysSlave = false;
    }
    if (hasText && !alwaysSlave) tableCols.push(c);
  }
  if (tableCols.length === 0) throw badRequest('머리글 줄에서 칸 이름을 찾지 못했습니다. 머리글 줄 번호를 확인해 주세요.');
  const left = tableCols[0];
  const right = tableCols.at(-1)!;

  const dataFirst = Math.max(headerLast + 1, options.dataFirst ?? headerLast + 1);
  const sequenceColumns = tableCols.filter(c => Array.from({ length: headerLast - headerFirst + 1 }, (_, i) =>
    key(masterText(ws, headerFirst + i, c))).some(label => SEQ_WORDS.includes(label)));
  const footerRow = Math.max(dataFirst, options.footerRow ?? detectFooterRow(ws, merges, dataFirst, left, right, sequenceColumns));

  // 제목 줄(머리글 위)에 교육이 하나만 나오면 그 양식의 교육으로 본다
  const titleText = Array.from({ length: headerFirst - 1 }, (_, i) => Array.from({ length: lastCol }, (_, c) => cellText(ws, i + 1, c + 1)).join(' ')).join(' ');
  const titleMatch = matchTraining(titleText, trainings);
  const ctx: GuessContext = { trainings, titleTraining: titleMatch.training };

  const columns: FormColumn[] = tableCols.map((col) => {
    const parts: string[] = [];
    for (let r = headerFirst; r <= headerLast; r++) {
      const text = masterText(ws, r, col).replace(/\s+/g, ' ');
      if (text && parts.at(-1) !== text) parts.push(text);
    }
    return { col, letter: columnLetter(col), label: parts.join(' › '), fill: guessFill(parts, ctx, warnings) };
  });

  if (!columns.some((c) => c.fill.kind === 'person' && c.fill.field === 'name')) warnings.push('성명 열을 찾지 못했습니다. 성명을 넣을 열을 골라 주세요.');
  if (merges.some((m) => m.top >= dataFirst && m.bottom < footerRow && m.right > m.left)) {
    warnings.push('사람을 쓸 줄 안에 합친 칸이 있습니다. 줄을 더 끼울 때 그 모양은 복사되지 않을 수 있습니다.');
  }
  let otherSheet = false;
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      if (isFormulaCell(cell) && refersOtherSheet(cell.formula ?? '', ws.name)) otherSheet = true;
    }),
  );
  if (otherSheet) warnings.push('다른 시트를 가리키는 수식이 있습니다. 줄을 끼워도 그 수식의 범위는 바뀌지 않으니 받은 뒤 확인해 주세요.');
  if (ws.getImages().length > 0) warnings.push('그림(로고·도장 등)이 있습니다. 줄을 끼우면 그림은 제자리에 남으니 받은 뒤 위치를 확인해 주세요.');

  const placeholders = new Set<string>();
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      for (const m of cellText(ws, Number(row.number), Number(cell.col)).matchAll(PLACEHOLDER_RE)) placeholders.add(m[1]);
    }),
  );

  const lastShown = Math.min(Math.max(ws.rowCount, footerRow), footerRow + 4, 60);
  const rows = Array.from({ length: lastShown }, (_, i) => ({
    row: i + 1,
    cells: Array.from({ length: right - left + 1 }, (_, c) => cellText(ws, i + 1, left + c)),
  }));

  return {
    workbookKind: isStatutoryTemplate(wb) ? 'statutory16' : 'generic',
    sheets: sheets.map((s) => s.name),
    layout: { sheetName: ws.name, headerFirst, headerLast, dataFirst, footerRow },
    columns,
    placeholders: [...placeholders],
    warnings: [...new Set(warnings)],
    rows,
  };
}
