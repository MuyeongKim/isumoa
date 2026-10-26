import ExcelJS from 'exceljs';

// 시험용 엑셀 도우미 (ExcelJS). 날짜는 엑셀이 시간대 없이 저장하므로 UTC 자정 Date로 넣는다.

/** 줄 목록으로 .xlsx를 만든다. 빈 배열은 빈 줄, Date 칸은 날짜 서식 */
export async function xlsxBuffer(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((values, r) => {
      const row = ws.getRow(r + 1);
      values.forEach((value, c) => {
        const cell = row.getCell(c + 1);
        cell.value = value as ExcelJS.CellValue;
        if (value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
      });
      row.commit();
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function loadXlsx(buf: Buffer | Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  return wb;
}

function plain(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return value.result;
  }
  return value ?? undefined;
}

/** 시트를 줄×칸 값 표로 (빈 칸은 undefined) */
export function sheetRows(ws: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, r) => {
    rows[r - 1] = Array.from({ length: ws.columnCount }, (_, c) => plain(row.getCell(c + 1).value));
  });
  return Array.from(rows, (r) => r ?? []);
}

/** headerRow번째 줄(1부터)을 머리글로 삼아 아래 줄을 객체로 */
export function sheetObjects(ws: ExcelJS.Worksheet, headerRow: number): Record<string, unknown>[] {
  const rows = sheetRows(ws);
  const header = (rows[headerRow - 1] ?? []).map((h) => String(h ?? ''));
  return rows
    .slice(headerRow)
    .filter((r) => r.some((v) => v !== undefined && v !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]).filter(([h]) => h !== '')));
}
