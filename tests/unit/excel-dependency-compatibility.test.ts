import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';

it('보안 패치한 압축·해제 의존성으로 inline 문자열 XLSX를 스트리밍 저장하고 다시 읽는다', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'isumoa-xlsx-compat-'));
  try {
    const file = join(folder, '가상자료.xlsx');
    const writer = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useSharedStrings: false });
    const sheet = writer.addWorksheet('가상교육');
    sheet.addRow(['성명', '교육명', '시간']).commit(); sheet.addRow(['홍길동', '개인정보보호 교육', 1]).commit();
    sheet.commit(); await writer.commit();
    const ordinary = new ExcelJS.Workbook(); await ordinary.xlsx.readFile(file);
    expect(ordinary.worksheets[0].getCell('B2').value).toBe('개인정보보호 교육');
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, {});
    const rows = [];
    for await (const ws of reader) for await (const row of ws) rows.push(row.values);
    expect(rows).toEqual([expect.arrayContaining(['성명', '교육명', '시간']), expect.arrayContaining(['홍길동', '개인정보보호 교육', 1])]);
  } finally { rmSync(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
});
