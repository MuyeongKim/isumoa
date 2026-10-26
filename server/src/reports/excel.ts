import ExcelJS from 'exceljs';
import { COMPLETION_LABELS, type CompletionState, type StatusCell, type StatusReport, type Training } from '../../../shared/types.ts';
import type { CertificateRecord } from './records.ts';

// 이수 현황 엑셀. 공문서 현황표처럼: 제목, 작성 기준, 머리행 바탕색, 가는 테두리.
//   1. 요약       교육별 대상·이수·미이수와 부서별 이수율
//   2. 직원별     직원 × 교육 (이수/부분이수/미이수/제외 — 바탕색과 글자를 함께)
//   3. 미이수자   미이수·부분이수만 한 줄씩 (부서에 보낼 독려 명단)
//   4. 상세 내역  근거가 된 이수증 한 장 × 인정 교육마다 한 줄

const FONT = '맑은 고딕';
const COLORS = {
  header: 'FFE8EDF6',
  border: 'FFD6DCE5',
  title: 'FF1C2A4A',
  muted: 'FF677287',
};
const STATE_FILL: Record<CompletionState, string> = {
  done: 'FFE5F2EB',
  partial: 'FFFBF1E0',
  none: 'FFFBECEB',
  exempt: 'FFEEF1F5',
};

export interface WorkbookInput {
  orgName: string;
  year: number;
  /** 예: "전체 부서", "총무과" */
  scopeLabel: string;
  createdBy: string;
  /** 아직 검수 대기라 빠진 이수증 수 */
  drafts: number;
  report: StatusReport;
  records: CertificateRecord[];
  now?: Date;
}

function requirement(t: Training): string {
  return t.reqType === 'hours' ? `연 ${t.reqValue}시간 이상` : `연 ${t.reqValue}회 이상`;
}

function cellText(cell: StatusCell): string {
  const label = cell.state === 'exempt' ? '제외' : COMPLETION_LABELS[cell.state];
  return cell.note && cell.state !== 'done' ? `${label} (${cell.note})` : label;
}

function seoulTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}

function dateCell(ymd: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : ymd;
}

function rate(target: number, done: number): number | string {
  return target > 0 ? done / target : '-';
}

const thin = { style: 'thin' as const, color: { argb: COLORS.border } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

/** 표 부분(머리행 + 본문)에 글꼴·테두리·머리행 바탕을 입힌다 */
function styleTable(ws: ExcelJS.Worksheet, headerRow: number, lastRow: number, lastCol: number) {
  for (let r = headerRow; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.border = BORDER;
      cell.font = { name: FONT, size: 10, bold: r === headerRow };
      cell.alignment = { vertical: 'middle', wrapText: r === headerRow, horizontal: r === headerRow ? 'center' : cell.alignment?.horizontal };
      if (r === headerRow) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    }
  }
  ws.getRow(headerRow).height = 30;
}

function addTitle(ws: ExcelJS.Worksheet, title: string, subtitle: string, width: number) {
  ws.mergeCells(1, 1, 1, Math.max(width, 4));
  ws.mergeCells(2, 1, 2, Math.max(width, 4));
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT, size: 14, bold: true, color: { argb: COLORS.title } };
  ws.getRow(1).height = 26;
  const s = ws.getCell(2, 1);
  s.value = subtitle;
  s.font = { name: FONT, size: 9, color: { argb: COLORS.muted } };
}

function setup(ws: ExcelJS.Worksheet, landscape = true) {
  ws.pageSetup = { orientation: landscape ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

export async function buildStatusWorkbook(input: WorkbookInput): Promise<Buffer> {
  const { report, records } = input;
  const now = input.now ?? new Date();
  const wb = new ExcelJS.Workbook();
  wb.creator = input.orgName || '이수모아';
  wb.created = now;

  const title = `${input.orgName ? `${input.orgName} ` : ''}${input.year}년 법정교육 이수 현황`;
  const subtitle = `범위: ${input.scopeLabel} · 작성: ${seoulTime(now.toISOString())} ${input.createdBy} · 확정한 이수증 기준${input.drafts > 0 ? ` (검수 대기 ${input.drafts}건은 들어 있지 않음)` : ''}`;
  const trainings = report.trainings;

  // 부서 순서는 직원 목록 순서(부서 정렬 순서) 그대로
  const departments: { id: number | null; name: string }[] = [];
  for (const row of report.rows) {
    if (!departments.some((d) => d.id === row.departmentId)) departments.push({ id: row.departmentId, name: row.departmentName ?? '부서 없음' });
  }

  // 1. 요약 ───────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('요약');
    const fixed = ['교육', '이수 기준', '대상(명)', '이수', '부분이수', '미이수', '대상 제외', '이수율'];
    const width = fixed.length + departments.length;
    addTitle(ws, title, subtitle, width);
    const headerRow = 5;
    if (departments.length > 0) {
      ws.mergeCells(4, fixed.length + 1, 4, width);
      const g = ws.getCell(4, fixed.length + 1);
      g.value = '부서별 이수율';
      g.font = { name: FONT, size: 10, bold: true };
      g.alignment = { horizontal: 'center' };
      g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
      g.border = BORDER;
    }
    ws.getRow(headerRow).values = [...fixed, ...departments.map((d) => d.name)];

    let r = headerRow;
    let total = { target: 0, done: 0, partial: 0, none: 0, exempt: 0 };
    for (const t of trainings) {
      const s = report.summary.find((x) => x.trainingId === t.id)!;
      total = { target: total.target + s.target, done: total.done + s.done, partial: total.partial + s.partial, none: total.none + s.none, exempt: total.exempt + s.exempt };
      const byDept = departments.map((d) => {
        const cells = report.rows.filter((row) => row.departmentId === d.id).map((row) => row.cells[t.id]);
        const target = cells.filter((c) => c.state !== 'exempt').length;
        return rate(target, cells.filter((c) => c.state === 'done').length);
      });
      ws.getRow(++r).values = [t.name, requirement(t), s.target, s.done, s.partial, s.none, s.exempt, rate(s.target, s.done), ...byDept];
    }
    const deptTotals = departments.map((d) => {
      const cells = report.rows.filter((row) => row.departmentId === d.id).flatMap((row) => trainings.map((t) => row.cells[t.id]));
      const target = cells.filter((c) => c.state !== 'exempt').length;
      return rate(target, cells.filter((c) => c.state === 'done').length);
    });
    ws.getRow(++r).values = ['전체 (직원 × 교육)', '', total.target, total.done, total.partial, total.none, total.exempt, rate(total.target, total.done), ...deptTotals];
    styleTable(ws, headerRow, r, width);
    ws.getRow(r).eachCell((c) => (c.font = { name: FONT, size: 10, bold: true }));
    for (let c = 3; c <= 7; c++) ws.getColumn(c).numFmt = '#,##0';
    for (let c = 8; c <= width; c++) ws.getColumn(c).numFmt = '0%';
    for (let row = headerRow + 1; row <= r; row++) {
      for (let c = 3; c <= width; c++) ws.getCell(row, c).alignment = { horizontal: 'right', vertical: 'middle' };
    }
    ws.getColumn(1).width = 30;
    ws.getColumn(2).width = 15;
    for (let c = 3; c <= 7; c++) ws.getColumn(c).width = 9;
    ws.getColumn(8).width = 9;
    for (let c = 9; c <= width; c++) ws.getColumn(c).width = 12;
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRow }];
    setup(ws);
  }

  // 2. 직원별 ─────────────────────────────────────────────
  {
    const ws = wb.addWorksheet('직원별');
    const header = ['부서', '사번', '성명', ...trainings.map((t) => t.name), '이수', '남음'];
    addTitle(ws, `${title} — 직원별`, subtitle, header.length);
    const headerRow = 4;
    ws.getRow(headerRow).values = header;
    let r = headerRow;
    for (const row of report.rows) {
      const cells = trainings.map((t) => row.cells[t.id]);
      const left = cells.filter((c) => c.state === 'none' || c.state === 'partial').length;
      const done = cells.filter((c) => c.state === 'done').length;
      const excelRow = ws.getRow(++r);
      excelRow.values = [row.departmentName ?? '', row.empNo ?? '', row.name, ...cells.map(cellText), done, left];
      cells.forEach((cell, i) => {
        excelRow.getCell(4 + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATE_FILL[cell.state] } };
      });
    }
    styleTable(ws, headerRow, r, header.length);
    // 바탕색은 styleTable이 머리행만 칠하므로 본문 칸 색은 위에서 칠한 그대로 남는다
    ws.getColumn(1).width = 14;
    ws.getColumn(2).width = 10;
    ws.getColumn(3).width = 9;
    trainings.forEach((_, i) => (ws.getColumn(4 + i).width = 13));
    ws.getColumn(header.length - 1).width = 6;
    ws.getColumn(header.length).width = 6;
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: header.length } };
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: headerRow }];
    setup(ws);
  }

  // 3. 미이수자 ───────────────────────────────────────────
  {
    const ws = wb.addWorksheet('미이수자');
    const header = ['부서', '사번', '성명', '교육', '상태', '이수 기준', '현재'];
    addTitle(ws, `${title} — 미이수자`, subtitle, header.length);
    const headerRow = 4;
    ws.getRow(headerRow).values = header;
    let r = headerRow;
    for (const row of report.rows) {
      for (const t of trainings) {
        const cell = row.cells[t.id];
        if (cell.state !== 'none' && cell.state !== 'partial') continue;
        const excelRow = ws.getRow(++r);
        excelRow.values = [row.departmentName ?? '', row.empNo ?? '', row.name, t.name, COMPLETION_LABELS[cell.state], requirement(t), cell.note ?? '-'];
        excelRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATE_FILL[cell.state] } };
      }
    }
    styleTable(ws, headerRow, r, header.length);
    [14, 10, 9, 28, 10, 15, 26].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: header.length } };
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    setup(ws, false);
  }

  // 4. 상세 내역 ──────────────────────────────────────────
  {
    const ws = wb.addWorksheet('상세 내역');
    const header = ['부서', '사번', '성명', '교육', '이수일', '인정 시간', '이수증 교육시간', '과정명', '교육기관', '이수번호', '원본 파일', '쪽', '확정한 사람', '확정 일시'];
    addTitle(ws, `${title} — 근거 이수증`, subtitle, header.length);
    const headerRow = 4;
    ws.getRow(headerRow).values = header;
    let r = headerRow;
    for (const rec of records) {
      ws.getRow(++r).values = [
        rec.departmentName ?? '',
        rec.empNo ?? '',
        rec.employeeName,
        rec.trainingName,
        dateCell(rec.completedOn),
        rec.creditedHours ?? '',
        rec.hoursText ?? (rec.hours !== null ? `${rec.hours}시간` : ''),
        rec.courseTitle ?? '',
        rec.provider ?? '',
        rec.certNo ?? '',
        rec.fileName,
        rec.pageNo,
        rec.confirmedBy ?? '',
        seoulTime(rec.confirmedAt),
      ];
    }
    styleTable(ws, headerRow, r, header.length);
    ws.getColumn(5).numFmt = 'yyyy-mm-dd';
    [14, 10, 9, 24, 11, 9, 12, 36, 18, 14, 30, 5, 10, 16].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: header.length } };
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    setup(ws);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
