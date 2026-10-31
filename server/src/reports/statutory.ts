import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { DEPLOYMENT_TRAININGS } from '../../../shared/deploymentCatalog.ts';
import type { FinalExportCheck } from '../../../shared/types.ts';
import { APP_ROOT } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { getSetting } from '../db/seed.ts';
import { loadWorkbook } from '../forms/analyze.ts';
import { loadRecords } from './records.ts';
import { loadStatusReport, type ReportScope } from './statusReport.ts';

const normalized = (s: string) => s.normalize('NFC').replace(/\s/g, '').toLowerCase();

export async function checkFinalExport(db: Kysely<DB>, filter: ReportScope, drafts: number): Promise<FinalExportCheck> {
  const report = await loadStatusReport(db, filter);
  const missingTrainings: string[] = [], criteriaWarnings: string[] = [];
  for (const d of DEPLOYMENT_TRAININGS) {
    const matches = report.trainings.filter(t => t.code === d.code || normalized(t.name) === normalized(d.name));
    if (matches.length !== 1) missingTrainings.push(d.name);
    else if (matches[0].reqType !== 'hours' || matches[0].reqValue !== d.reqValue) criteriaWarnings.push(d.name);
  }
  const blockers: FinalExportCheck['blockers'] = [];
  let employees = 0;
  for (const row of report.rows) {
    const applicable = report.trainings.filter(t => row.cells[t.id].state !== 'exempt');
    if (!applicable.length) continue;
    employees++;
    for (const t of applicable) { const cell = row.cells[t.id]; if (cell.state !== 'done') blockers.push({ employeeId: row.employeeId, name: row.name, department: row.departmentName, training: t.name, hours: t.reqType === 'count' ? cell.count : cell.hours, required: t.reqValue, unit: t.reqType === 'hours' ? '시간' : '회', state: cell.state }); }
  }
  return { ready: employees > 0 && !missingTrainings.length && !blockers.length && drafts === 0, employees, missingTrainings, criteriaWarnings, blockers, drafts };
}

/** 공식 16시트 양식: 수료증별 내역을 유지하고 이수 인원은 직원 ID로 중복 제거한다. */
export async function buildStatutoryWorkbook(db: Kysely<DB>, filter: ReportScope, template?: Uint8Array, onlyDepartment?: number | null): Promise<Buffer> {
  const report = await loadStatusReport(db, filter), records = await loadRecords(db, filter);
  const org = await getSetting(db, 'org', { name: '' });
  const details = new Map((await db.selectFrom('employees').select(['id', 'position']).execute()).map(e => [e.id, e]));
  const wb = await loadWorkbook(template ?? await readFile(join(APP_ROOT, 'vendor/forms/statutory-2026.xlsx')));
  // 원본 서식에 남은 외부 통합문서 이름은 보고 파일에서 연결하지 않는다.
  wb.definedNames.model = wb.definedNames.model.filter(n => n.ranges.every(r => !/\[[^\]]+\]/.test(r)));
  const people = new Map(report.rows.filter(row => onlyDepartment === undefined || row.departmentId === onlyDepartment).map(row => [row.employeeId, row]));
  for (const def of DEPLOYMENT_TRAININGS) {
    const ws = wb.getWorksheet(def.sheetName); if (!ws) throw Error(`기본 양식의 ${def.sheetName} 시트가 없습니다.`);
    const training = report.trainings.find(t => t.code === def.code || normalized(t.name) === normalized(def.name));
    if (!training) throw Error(`교육 기준이 없습니다: ${def.name}`);
    const rows = records.filter(r => r.trainingId === training.id && people.has(r.employeeId) && people.get(r.employeeId)!.cells[training.id].state !== 'exempt');
    if (training.reqType !== 'hours' || training.reqValue !== def.reqValue) ws.getCell('B2').value = `${training.name} 이수현황(연 ${training.reqValue}${training.reqType === 'hours' ? '시간' : '회'} 이상)`;
    const first = 9, end = Math.max(265, first + rows.length - 1);
    if (end > 265) ws.duplicateRow(9, end - 265, true);
    for (let r = first; r <= end; r++) for (let c = 1; c <= 13; c++) ws.getCell(r, c).value = null;
    for (const [i, rec] of rows.entries()) {
      const row = ws.getRow(first + i), date = rec.completedOn ? new Date(rec.completedOn + 'T00:00:00Z') : null;
      const cell = people.get(rec.employeeId)!.cells[training.id];
      const notes = [rec.certNo ? null : '수료증 번호 미기재', cell.state === 'done' ? null : `기준 미충족 (${cell.note ?? '이수 현황 확인'})`].filter(Boolean).join('; ');
      row.values = [i + 1, org.name, rec.departmentName, details.get(rec.employeeId)?.position ?? null, rec.employeeName, rec.provider, rec.courseTitle, rec.creditedHours, date, rec.certNo, notes || null];
      row.getCell(8).numFmt = Number.isInteger(rec.creditedHours) ? '0"시간"' : '0.##"시간"'; row.getCell(9).numFmt = 'yyyy-mm-dd'; row.getCell(10).numFmt = '@';
      row.alignment = { vertical: 'middle', wrapText: true };
      const lines = [2,3,6,7,10,11].map(col => Math.ceil([...String(row.getCell(col).value ?? '')].reduce((n,ch)=>n+(ch.charCodeAt(0)>127?2:1),0)/Math.max(8,ws.getColumn(col).width??10)));
      row.height = Math.min(409,Math.max(row.height??20,...lines.map(n=>n*15+6)));
    }
    ws.getCell('B4').value = null;
    ws.getCell('K4').value = new Set(rows.filter(r => people.get(r.employeeId)!.cells[training.id].state === 'done').map(r => r.employeeId)).size;
    ws.getCell('E4').value = { formula: 'IF(B4>0,K4/B4,"")', result: '' };
    ws.autoFilter = `A8:K${end}`;
    ws.pageSetup.printArea = `A1:K${Math.max(9, first + rows.length - 1)}`;
  }
  wb.creator = '이수모아'; wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
