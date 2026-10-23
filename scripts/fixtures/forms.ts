import ExcelJS from 'exceljs';

// 시연·테스트용 가상 제출 양식 (기관에서 흔히 받는 명단형 양식 모양). 실제 기관 양식이 아님.
//   1. 한 줄 머리글, 테두리만 그린 빈 줄 20개, 교육마다 한 열
//   2. 두 줄 머리글(합친 칸), 빈 줄 5개, 합계 수식, O·X 고르기 목록, "위와 같이 제출합니다"·서명란, {부서명}·{작성일}
//   3. 교육 하나짜리 명단(제목에 교육 이름), 빈 줄 없이 바로 서명란, {작성자}

const FONT = '맑은 고딕';
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };
const HEAD_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } };

function headCell(cell: ExcelJS.Cell, value?: string) {
  if (value !== undefined) cell.value = value;
  cell.border = box;
  cell.fill = HEAD_FILL;
  cell.font = { name: FONT, size: 10, bold: true };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function bodyRows(ws: ExcelJS.Worksheet, from: number, to: number, cols: number, dateCols: number[] = []) {
  for (let r = from; r <= to; r++) {
    ws.getRow(r).height = 18;
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      cell.border = box;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (dateCols.includes(c)) cell.numFmt = 'yyyy-mm-dd';
    }
  }
}

function title(ws: ExcelJS.Worksheet, range: string, text: string) {
  ws.mergeCells(range);
  const cell = ws.getCell(range.split(':')[0]);
  cell.value = text;
  cell.font = { name: FONT, size: 16, bold: true };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(cell.row as unknown as number).height = 30;
}

async function save(wb: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 1. 한 줄 머리글 + 빈 줄 20개 */
export async function formOneRowHeader(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('이수현황', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const head = ['번호', '부서', '직위', '성명', '성희롱예방', '성폭력예방', '성매매예방', '가정폭력예방', '청렴교육', '장애인인식개선', '개인정보보호', '비고'];
  ws.columns = [6, 12, 10, 10, 10, 10, 10, 11, 10, 12, 11, 16].map((width) => ({ width }));
  title(ws, 'A1:L1', '2026년 법정의무교육 이수 현황');
  head.forEach((h, i) => headCell(ws.getCell(3, i + 1), h));
  bodyRows(ws, 4, 23, head.length);
  return save(wb);
}

/** 2. 두 줄 머리글 + 합계 + 서명란 (사전 시험에 쓴 모양) */
export async function formTwoRowHeader(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('제출양식', { pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [6, 14, 10, 10, 13, 9, 9, 13, 16].map((width) => ({ width }));
  title(ws, 'A1:I1', '2026년 법정의무교육 이수 현황');
  ws.mergeCells('A2:I2');
  ws.getCell('A2').value = '부서명: {부서명}          작성일: {작성일}';
  ws.getCell('A2').font = { name: FONT, size: 10 };
  for (const [range, text] of [
    ['A4:A5', '연번'],
    ['B4:B5', '소속'],
    ['C4:C5', '직급'],
    ['D4:D5', '성명'],
    ['E4:F4', '성희롱 예방교육'],
    ['G4:H4', '청렴교육'],
    ['I4:I5', '비고'],
  ] as const) {
    ws.mergeCells(range);
    ws.getCell(range.split(':')[0]).value = text;
  }
  Object.entries({ E5: '이수일', F5: '이수시간', G5: '이수여부', H5: '이수일' }).forEach(([a, v]) => (ws.getCell(a).value = v));
  for (let r = 4; r <= 5; r++) for (let c = 1; c <= 9; c++) headCell(ws.getCell(r, c));
  bodyRows(ws, 6, 10, 9, [5, 8]);
  for (let r = 6; r <= 10; r++) ws.getCell(`G${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"O,X"'] };
  ws.getCell('C11').value = '계';
  ws.getCell('D11').value = { formula: 'COUNTA(D6:D10)' } as ExcelJS.CellFormulaValue;
  ws.getCell('F11').value = { formula: 'SUM(F6:F10)' } as ExcelJS.CellFormulaValue;
  ws.getCell('G11').value = { formula: 'COUNTIF(G6:G10,"O")' } as ExcelJS.CellFormulaValue;
  for (let c = 1; c <= 9; c++) {
    ws.getCell(11, c).border = box;
    ws.getCell(11, c).font = { name: FONT, size: 10, bold: true };
    ws.getCell(11, c).alignment = { horizontal: 'center' };
  }
  ws.mergeCells('A13:I13');
  ws.getCell('A13').value = '위와 같이 제출합니다.';
  ws.getCell('A13').alignment = { horizontal: 'center' };
  ws.mergeCells('G15:I15');
  ws.getCell('G15').value = '작성자:            (서명)';
  ws.pageSetup.printArea = 'A1:I15';
  return save(wb);
}

/** 3. 교육 하나짜리 명단 — 빈 줄 없이 머리글 바로 아래 서명란 */
export async function formSingleTraining(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('명단');
  ws.columns = [7, 14, 10, 13, 10, 10].map((width) => ({ width }));
  title(ws, 'A1:F1', '2026년 성희롱 예방교육 이수자 명단');
  ['순번', '소속', '성명', '이수일', '교육시간', '이수여부'].forEach((h, i) => headCell(ws.getCell(3, i + 1), h));
  ws.mergeCells('A5:F5');
  ws.getCell('A5').value = '작성자: {작성자}';
  ws.getCell('A5').alignment = { horizontal: 'right' };
  return save(wb);
}

export const SAMPLE_FORMS: [string, () => Promise<Buffer>][] = [
  ['1_한줄머리글_빈줄20개.xlsx', formOneRowHeader],
  ['2_두줄머리글_합계_서명란.xlsx', formTwoRowHeader],
  ['3_교육하나_빈줄없음.xlsx', formSingleTraining],
];
