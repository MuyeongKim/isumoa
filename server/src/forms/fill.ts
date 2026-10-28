import type ExcelJS from 'exceljs';
import {
  COMPLETION_LABELS,
  FORM_MARKS,
  type CompletionState,
  type FormColumn,
  type FormColumnFill,
  type FormLayout,
  type FormMarkStyle,
} from '../../../shared/types.ts';
import { badRequest } from '../lib/errors.ts';
import { loadWorkbook, PLACEHOLDERS } from './analyze.ts';
import { isDateFormat, isFormulaCell, shiftAfter, translateRows, valueText } from './sheet.ts';

// 제출 양식에 사람을 한 줄씩 써 넣는다. 양식의 제목·머리글·테두리·합계·서명란은 그대로 두고,
// 미리 그려 둔 줄이 모자라면 첫 줄을 복사해 끼운다 (아래 합친 칸·서명란은 따라 내려간다).

export interface FormTrainingValue {
  state: CompletionState;
  hours: number;
  /** 그해 확정 이수증 중 가장 최근 이수일 (YYYY-MM-DD) */
  date: string | null;
  course: string | null;
  provider: string | null;
  certNo?: string | null;
}

export interface FormPerson {
  name: string;
  organization?: string | null;
  department: string | null;
  position: string | null;
  empNo: string | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  empType: string | null;
  trainings: Record<number, FormTrainingValue>;
  /** 아직 이수하지 않은(미이수·부분이수) 교육의 짧은 이름 */
  missing: string[];
}

export interface FillInput {
  file: Uint8Array;
  layout: FormLayout;
  columns: FormColumn[];
  markStyle: FormMarkStyle;
  people: FormPerson[];
  /** {부서명} 같은 자리표시에 넣을 값 */
  placeholders: Partial<Record<(typeof PLACEHOLDERS)[number], string>>;
}

type Value = string | number | null;

/** 칸에 넣을 값. 날짜는 'YYYY-MM-DD' 글자로 두고, 쓸 때 칸 서식을 보고 날짜나 "2026.04.01"로 바꾼다 */
export function fillValue(fill: FormColumnFill, person: FormPerson, index: number, markStyle: FormMarkStyle): { value: Value; date?: boolean } | undefined {
  switch (fill.kind) {
    case 'none':
      return undefined;
    case 'missing':
      return { value: person.missing.join(', ') || null };
    case 'person': {
      if (fill.field === 'seq') return { value: index + 1 };
      if (fill.field === 'birthDate') return { value: person.birthDate, date: true };
      return { value: person[fill.field] ?? null };
    }
    case 'training': {
      const t = person.trainings[fill.trainingId];
      if (!t) return { value: null };
      if (fill.format === 'mark') return { value: t.state === 'exempt' ? '-' : t.state === 'done' ? FORM_MARKS[markStyle].done : FORM_MARKS[markStyle].notDone };
      if (fill.format === 'status') return { value: COMPLETION_LABELS[t.state] };
      if (t.state === 'exempt') return { value: null };
      if (fill.format === 'date') return { value: t.date, date: true };
      if (fill.format === 'hours') return { value: t.hours > 0 ? t.hours : null };
      return { value: fill.format === 'certNo' ? t.certNo ?? null : fill.format === 'course' ? t.course : t.provider };
    }
  }
}

/** 날짜 글자를 칸에 맞게: 날짜 서식 칸이면 엑셀 날짜, 아니면 "2026.04.01" */
function dateCell(iso: string, numFmt: string | undefined): Date | string {
  const [y, m, d] = iso.split('-').map(Number);
  return isDateFormat(numFmt) ? new Date(Date.UTC(y, m - 1, d)) : `${y}.${String(m).padStart(2, '0')}.${String(d).padStart(2, '0')}`;
}

/** 화면 미리보기용 글자 (엑셀에 쓰는 값과 같게, 날짜는 2026.04.01) */
export function previewText(fill: FormColumnFill, person: FormPerson, index: number, markStyle: FormMarkStyle): string {
  const v = fillValue(fill, person, index, markStyle);
  if (!v || v.value === null) return '';
  return v.date ? String(dateCell(String(v.value), undefined)) : String(v.value);
}

function replacePlaceholders(text: string, values: FillInput['placeholders']): string {
  return text.replace(/\{([^{}]+)\}/g, (m, name: string) => values[name as keyof typeof values] ?? m);
}

/** 시트 전체 수식·범위의 행 주소를 고친다 (줄을 끼운 뒤) */
function shiftSheet(ws: ExcelJS.Worksheet, after: number, by: number, skip: (row: number) => boolean) {
  // 공유 수식은 고친 순서에 따라 결과가 달라질 수 있어, 먼저 모두 읽은 뒤 한꺼번에 바꾼다
  const formulas: [ExcelJS.Cell, string][] = [];
  ws.eachRow((row) => {
    if (skip(Number(row.number))) return;
    row.eachCell((cell) => {
      if (isFormulaCell(cell)) formulas.push([cell, cell.formula]);
    });
  });
  for (const [cell, formula] of formulas) cell.value = { formula: shiftAfter(formula, ws.name, after, by) } as ExcelJS.CellFormulaValue;

  const cf = (ws as unknown as { conditionalFormattings?: { ref: string }[] }).conditionalFormattings;
  for (const rule of cf ?? []) rule.ref = shiftAfter(rule.ref, ws.name, after, by);
  if (ws.pageSetup.printArea) ws.pageSetup.printArea = shiftAfter(ws.pageSetup.printArea, ws.name, after, by);
  if (typeof ws.autoFilter === 'string') ws.autoFilter = shiftAfter(ws.autoFilter, ws.name, after, by);
}

export async function fillForm(input: FillInput): Promise<Buffer> {
  const { layout, columns, markStyle, people } = input;
  const wb = await loadWorkbook(input.file);
  const ws = wb.getWorksheet(layout.sheetName);
  if (!ws) throw badRequest(`양식에서 '${layout.sheetName}' 시트를 찾을 수 없습니다. 양식을 다시 올려 주세요.`);

  const cols = columns.map((c) => c.col);
  const left = Math.min(...cols);
  const right = Math.max(...cols);
  const fillByCol = new Map(columns.map((c) => [c.col, c.fill]));
  const first = layout.dataFirst;
  const prepared = Math.max(0, layout.footerRow - layout.dataFirst);
  const n = people.length;

  if (prepared === 0 && n > 0) {
    // 빈 줄이 없는 양식: 머리글 마지막 줄을 본떠 줄을 만들고 테두리만 남긴다
    ws.duplicateRow(layout.headerLast, n, true);
    shiftSheet(ws, layout.headerLast, n, (r) => r > layout.headerLast && r <= layout.headerLast + n);
    for (let r = first; r < first + n; r++) {
      const row = ws.getRow(r);
      for (let c = left; c <= right; c++) {
        const cell = row.getCell(c);
        const style = cell.style;
        cell.value = null;
        cell.style = {
          border: style.border,
          font: { ...style.font, bold: false },
          alignment: { horizontal: 'center', vertical: 'middle' },
        };
      }
    }
  } else if (n > prepared) {
    // 미리 그린 줄이 모자람: 첫 줄을 복사해 그 아래에 끼운다 → 아래 행을 가리키던 범위(합계 등)는 늘어난다
    const extra = n - prepared;
    const templateFormulas = new Map<number, string>();
    const templateValidation = new Map<number, ExcelJS.DataValidation>();
    for (let c = left; c <= right; c++) {
      const cell = ws.getCell(first, c);
      if (isFormulaCell(cell)) templateFormulas.set(c, cell.formula);
      if (cell.dataValidation) templateValidation.set(c, cell.dataValidation);
    }
    ws.duplicateRow(first, extra, true);
    shiftSheet(ws, first, extra, (r) => r > first && r <= first + extra);
    for (let r = first + 1; r <= first + extra; r++) {
      for (const [c, formula] of templateFormulas) {
        ws.getCell(r, c).value = { formula: translateRows(shiftAfter(formula, ws.name, first, extra), ws.name, first, r) } as ExcelJS.CellFormulaValue;
      }
    }
    for (let r = first + 1; r < first + n; r++) {
      for (const [c, rule] of templateValidation) if (!ws.getCell(r, c).dataValidation) ws.getCell(r, c).dataValidation = rule;
    }
  }

  // 사람을 쓰는 줄: 남아 있는 예시 글자는 지우고(수식은 둔다) 한 사람씩 쓴다
  const rowsUsed = Math.max(n, prepared);
  for (let i = 0; i < rowsUsed; i++) {
    const r = first + i;
    for (let c = left; c <= right; c++) {
      const cell = ws.getCell(r, c);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const person = people[i];
      const fill = fillByCol.get(c) ?? { kind: 'none' as const };
      const v = person ? fillValue(fill, person, i, markStyle) : undefined;
      if (v) {
        cell.value = v.value === null ? null : v.date ? dateCell(String(v.value), cell.numFmt) : v.value;
      } else if (!isFormulaCell(cell) && valueText(cell.value) !== '') {
        cell.value = null;
      }
    }
  }

  // {부서명} 같은 자리표시
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v === 'string' && v.includes('{')) cell.value = replacePlaceholders(v, input.placeholders);
      else if (v && typeof v === 'object' && 'richText' in v && v.richText.some((t) => t.text.includes('{'))) {
        cell.value = { richText: v.richText.map((t) => ({ ...t, text: replacePlaceholders(t.text, input.placeholders) })) };
      }
    }),
  );

  // 합계 같은 수식은 엑셀이 열 때 다시 계산한다
  wb.calcProperties = { ...wb.calcProperties, fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
