import type ExcelJS from 'exceljs';
import { DEPLOYMENT_TRAININGS } from '../../../shared/deploymentCatalog.ts';
const headers = ['연번','소속','부서','계급','성명','교육기관','교육과정','수료시간','수료일자','수료증번호','비고'];
const key = (s: string) => s.normalize('NFC').replace(/\s/g, '');
/** 이름만 비슷한 임의 양식에 적용하지 않고 16시트와 표 머리글을 모두 확인한다. */
export function isStatutoryTemplate(wb: ExcelJS.Workbook): boolean {
  return wb.worksheets.length === 16 && DEPLOYMENT_TRAININGS.every(t => {
    const sheet = wb.getWorksheet(t.sheetName);
    return !!sheet && headers.every((h, i) => key(sheet.getCell(8, i + 1).text) === h);
  });
}
