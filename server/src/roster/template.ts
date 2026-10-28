import ExcelJS from 'exceljs';

/** 빈 입력 시트를 첫 탭에 둔다. 예시 직원 행은 포함하지 않는다. */
export async function buildRosterTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('직원명단');
  const headers = ['사번', '성명', '부서', '직급·직위', '직종', '생년월일', '재직 상태', '임용일', '퇴직일'];
  ws.addRow(headers); ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.columns = [18, 15, 24, 18, 16, 18, 16, 18, 18].map(width => ({ width }));
  ws.getRow(1).height = 28;
  headers.forEach((_, i) => { const c = ws.getCell(1, i + 1); c.font = { name: '맑은 고딕', bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 1 || i === 2 ? 'FF2438A6' : 'FF4A5263' } }; c.alignment = { vertical: 'middle', horizontal: 'center' }; });
  for (let r = 2; r <= 501; r++) {
    for (let c = 1; c <= 9; c++) ws.getCell(r, c).numFmt = '@';
    ws.getCell(r, 7).dataValidation = { type: 'list', allowBlank: true, formulae: ['"재직,휴직,파견,퇴직"'], showErrorMessage: true, errorTitle: '재직 상태 확인', error: '목록에서 재직·휴직·파견·퇴직을 골라 주세요.' };
  }
  ws.autoFilter = 'A1:I501';
  const notes = wb.addWorksheet('작성안내'); notes.columns = [{ width: 22 }, { width: 95 }];
  [['항목', '작성 방법'], ['필수 항목', '성명과 부서는 꼭 입력하세요. 직원은 직원명단 시트의 2행부터 작성합니다.'], ['사번', '고유한 사번을 권장합니다. 001처럼 앞의 0이 유지되도록 문자 형식으로 제공합니다.'], ['생년월일·임용일·퇴직일', 'YYYY-MM-DD 형식으로 적습니다. 예: 1985-03-12. 생년월일은 동명이인 구분에 쓰며 주민등록번호는 적지 마세요.'], ['재직 상태', '재직·휴직·파견·퇴직 중 선택합니다. 빈칸은 재직으로 처리합니다.'], ['추가 행', '500명을 넘으면 아래에 계속 작성할 수 있습니다.'], ['등록 순서', '작성한 파일 업로드 → 열 확인 → 바뀌는 내용 미리보기 → 반영하기. 작성안내 시트는 등록하지 않습니다.']].forEach(row => notes.addRow(row));
  notes.getColumn(2).alignment = { wrapText: true, vertical: 'middle' }; notes.eachRow(row => { row.height = 36; });
  wb.creator = '이수모아'; return Buffer.from(await wb.xlsx.writeBuffer());
}
