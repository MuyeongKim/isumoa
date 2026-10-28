import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { CompletionState, Training } from '../../shared/types.ts';
import { formOneRowHeader, formSingleTraining, formTwoRowHeader } from '../../scripts/fixtures/forms.ts';
import { analyzeForm, assertXlsx, matchTraining } from '../../server/src/forms/analyze.ts';
import { fillForm, type FormPerson } from '../../server/src/forms/fill.ts';
import { isDateFormat, shiftAfter, translateRows } from '../../server/src/forms/sheet.ts';
import { PUBLIC_SECTOR_TRAININGS } from '../../server/src/db/trainingCatalog.ts';

const TRAININGS: Training[] = PUBLIC_SECTOR_TRAININGS.map((t, i) => ({
  id: i + 1,
  code: t.code,
  name: t.name,
  category: t.category,
  legalBasis: t.legalBasis,
  reqType: t.reqType,
  reqValue: t.reqValue,
  keywords: t.keywords,
  fromYear: null,
  toYear: null,
  active: t.active,
  sortOrder: i,
  note: null,
}));

const STATES: CompletionState[] = ['done', 'partial', 'none'];
function people(n: number): FormPerson[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `직원${i + 1}`,
    department: '총무과',
    position: '행정7급',
    empNo: String(1000 + i),
    birthDate: '1985-03-12',
    empType: '일반직',
    trainings: Object.fromEntries(
      TRAININGS.map((t) => {
        const state = STATES[(i + t.id) % 3];
        return [t.id, { state, hours: state === 'done' ? 1 : 0, date: state === 'done' ? '2026-04-01' : null, course: null, provider: null }];
      }),
    ),
    missing: [],
  }));
}

async function fill(form: Buffer, n: number) {
  const a = await analyzeForm(form, TRAININGS);
  const out = await fillForm({
    file: form,
    layout: a.layout,
    columns: a.columns,
    markStyle: 'ox',
    people: people(n),
    placeholders: { 부서명: '총무과', 작성일: '2026. 10. 23.', 작성자: '교육담당' },
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  return { a, ws: wb.worksheets[0] };
}

const merges = (ws: ExcelJS.Worksheet) => Object.keys((ws as unknown as { _merges: object })._merges).sort();

describe('수식 안의 칸 주소', () => {
  it('끼운 줄 아래를 가리키는 주소만 밀고, 문자열·다른 시트·함수 이름은 그대로', () => {
    expect(shiftAfter('COUNTA(D6:D10)', 'S', 6, 10)).toBe('COUNTA(D6:D20)');
    expect(shiftAfter('COUNTIF(G6:G10,"G7")+$A$11', 'S', 6, 5)).toBe('COUNTIF(G6:G15,"G7")+$A$16');
    expect(shiftAfter("SUM(Other!A7:A9)+'S'!B7+LOG10(A8)", 'S', 6, 2)).toBe("SUM(Other!A7:A9)+'S'!B9+LOG10(A10)");
    expect(shiftAfter("'제출양식'!$A$1:$I$15", '제출양식', 6, 10)).toBe("'제출양식'!$A$1:$I$25");
  });

  it('아래로 채우기는 상대 주소만 옮긴다', () => {
    expect(translateRows('IF(E6<>"",E$5,$F6)', 'S', 6, 9)).toBe('IF(E9<>"",E$5,$F9)');
  });

  it('날짜 서식인지', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('[$-ko-KR]yyyy"년" m"월"')).toBe(true);
    expect(isDateFormat('General')).toBe(false);
    expect(isDateFormat('0.0"시간"')).toBe(false);
  });
});

describe('양식 읽기', () => {
  it('테두리가 없어도 연번만 이어진 빈 자리는 재사용하고 합계와 기존 내용은 보존한다', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('제출');
    ws.addRow(['연번', '부서', '성명', '청렴교육(시간)']);
    ws.addRow([1]); ws.addRow([2]); ws.addRow(['합계']);
    let a = await analyzeForm(Buffer.from(await wb.xlsx.writeBuffer()), TRAININGS);
    expect(a.layout).toMatchObject({ dataFirst: 2, footerRow: 4 });
    const result = await fillForm({ file: Buffer.from(await wb.xlsx.writeBuffer()), layout: a.layout, columns: a.columns, markStyle: 'ox', people: people(2), placeholders: {} });
    const out = new ExcelJS.Workbook(); await out.xlsx.load(result as unknown as ArrayBuffer);
    expect(out.worksheets[0].getCell('C2').value).toBe('직원1');
    expect(out.worksheets[0].getCell('C3').value).toBe('직원2');
    expect(out.worksheets[0].getCell('A4').value).toBe('합계');
    ws.getCell('C3').value = '기존 내용';
    a = await analyzeForm(Buffer.from(await wb.xlsx.writeBuffer()), TRAININGS);
    expect(a.layout.footerRow).toBe(3);
  });
  it('엑셀(.xlsx)이 아니면 거절', () => {
    expect(() => assertXlsx(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), 'a.xls')).toThrow(/xlsx/);
    expect(() => assertXlsx(Buffer.from('PK\x03\x04'), 'a.xlsm')).toThrow(/매크로/);
    expect(() => assertXlsx(Buffer.from('%PDF'), 'a.pdf')).toThrow();
  });

  it('여러 교육에 걸친 머리글(4대폭력)은 고르지 않는다', () => {
    expect(matchTraining('4대폭력 예방교육', TRAININGS)).toEqual({ training: null, ambiguous: true });
    expect(matchTraining('청렴교육(부패방지)', TRAININGS).training?.code).toBe(PUBLIC_SECTOR_TRAININGS[4].code);
  });

  it('한 줄 머리글: 교육마다 한 열을 이수 표시로', async () => {
    const a = await analyzeForm(await formOneRowHeader(), TRAININGS);
    expect(a.layout).toEqual({ sheetName: '이수현황', headerFirst: 3, headerLast: 3, dataFirst: 4, footerRow: 24 });
    expect(a.columns.filter((c) => c.fill.kind === 'training').every((c) => c.fill.kind === 'training' && c.fill.format === 'mark')).toBe(true);
    expect(a.columns.filter((c) => c.fill.kind === 'training')).toHaveLength(7);
    expect(a.columns.at(-1)).toMatchObject({ label: '비고', fill: { kind: 'none' } });
  });

  it('제목의 교육 이름을 교육 하나짜리 양식의 교육으로 본다', async () => {
    const a = await analyzeForm(await formSingleTraining(), TRAININGS);
    expect(a.layout.footerRow).toBe(a.layout.dataFirst); // 빈 줄 없음
    expect(a.columns.map((c) => (c.fill.kind === 'training' ? `${c.fill.trainingId}:${c.fill.format}` : c.fill.kind))).toEqual([
      'person',
      'person',
      'person',
      '1:date',
      '1:hours',
      '1:mark',
    ]);
    expect(a.placeholders).toEqual(['작성자']);
  });
});

describe('채우기', () => {
  it('빈 줄보다 사람이 많으면 줄을 끼우고, 합계·목록·인쇄 영역·서명란을 함께 고친다', async () => {
    const { ws } = await fill(await formTwoRowHeader(), 15);
    expect(merges(ws)).toEqual(['A1', 'A2', 'A23', 'A4', 'B4', 'C4', 'D4', 'E4', 'G25', 'G4', 'I4'].sort());
    expect(ws.getCell('D20').value).toBe('직원15');
    expect(ws.getCell('A20').value).toBe(15);
    expect(ws.getCell('C21').value).toBe('계');
    expect(ws.getCell('D21').value).toMatchObject({ formula: 'COUNTA(D6:D20)' });
    expect(ws.getCell('F21').value).toMatchObject({ formula: 'SUM(F6:F20)' });
    expect(ws.getCell('G21').value).toMatchObject({ formula: 'COUNTIF(G6:G20,"O")' });
    expect(ws.getCell('G18').dataValidation).toMatchObject({ type: 'list', formulae: ['"O,X"'] });
    expect(ws.getCell('D18').border?.left).toBeTruthy();
    expect(ws.pageSetup.printArea).toBe('A1:I25');
    expect(ws.getCell('A2').value).toBe('부서명: 총무과          작성일: 2026. 10. 23.');
    expect(ws.getCell('A23').value).toBe('위와 같이 제출합니다.');
  });

  it('사람이 적으면 남은 빈 줄은 그대로 둔다', async () => {
    const { ws } = await fill(await formOneRowHeader(), 3);
    expect(ws.getCell('D6').value).toBe('직원3');
    expect(ws.getCell('D7').value).toBeNull();
    expect(ws.getCell('D23').border?.bottom).toBeTruthy(); // 20줄 양식 모양 유지
    expect(ws.rowCount).toBe(23);
  });

  it('빈 줄이 없는 양식은 머리글을 본떠 테두리 있는 줄을 만든다', async () => {
    const { ws } = await fill(await formSingleTraining(), 4);
    expect([4, 5, 6, 7].map((r) => ws.getCell(`C${r}`).value)).toEqual(['직원1', '직원2', '직원3', '직원4']);
    expect(ws.getCell('C5').border?.left).toBeTruthy();
    expect(ws.getCell('C5').font?.bold).toBeFalsy();
    expect(ws.getCell('A9').value).toBe('작성자: 교육담당'); // 서명란은 4줄 내려감
  });
});
