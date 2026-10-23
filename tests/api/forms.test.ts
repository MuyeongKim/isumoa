import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditPage, CertificateListItem, FormAnalysis, FormPreview, FormTemplate } from '../../shared/types.ts';
import { formTwoRowHeader } from '../../scripts/fixtures/forms.ts';
import { createHarness, multipart, PDF, type Harness } from './harness.ts';

// 제출 양식: 올리기 → 자리 찾기 → 미리보기 → 저장 → 채워 받기, 그리고 서무 권한.

const REASON = encodeURIComponent('감사·점검 제출');
let h: Harness;
let clerkCookie = '';
let generalId: number;
let financeId: number;

const cert = (name: string, dept: string, course: string, date: string, hours: string) =>
  ['수 료 증', `성 명 : ${name}`, `소 속 : 가람시 ${dept}`, `과 정 명 : ${course}`, `이수일자 : ${date}`, `교육시간 : ${hours}`, '가상인재개발원장'].join('\n');

function as(cookie: string | undefined, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return cookie
    ? h.app.inject({ method, url, payload: payload as object, headers: { 'x-requested-with': 'fetch', cookie, ...headers } })
    : h.send(method as 'GET', url, payload, headers);
}

function upload(file: Buffer, name: string, cookie?: string) {
  const body = multipart([{ name: 'file', value: file, filename: name, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }]);
  return as(cookie, 'POST', '/api/forms/analyze', body.payload, body.headers);
}

async function readSheet(buf: Buffer): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb.worksheets[0];
}

beforeAll(async () => {
  h = await createHarness();
  generalId = (await h.db.insertInto('departments').values({ name: '총무과', sort_order: 1 }).returning('id').executeTakeFirstOrThrow()).id;
  financeId = (await h.db.insertInto('departments').values({ name: '재무과', sort_order: 2 }).returning('id').executeTakeFirstOrThrow()).id;
  await h.db
    .insertInto('employees')
    .values([
      { name: '오호영', name_key: '오호영', department_id: generalId, emp_no: '1001', position: '행정7급' },
      { name: '송주주', name_key: '송주주', department_id: generalId, emp_no: '1002', position: '행정8급' },
      { name: '김재무', name_key: '김재무', department_id: financeId, emp_no: '2001', position: '행정6급' },
    ])
    .execute();

  await h.send('POST', '/api/users', { loginId: 'clerk1', name: '총무서무', role: 'clerk', departmentIds: [generalId], password: 'Clerk1234!' });
  const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk1', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
  const changed = await h.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: { currentPassword: 'Clerk1234!', newPassword: 'General5678!' },
    headers: { 'x-requested-with': 'fetch', cookie: `ecp_sid=${login.cookies.find((c) => c.name === 'ecp_sid')!.value}` },
  });
  clerkCookie = `ecp_sid=${changed.cookies.find((c) => c.name === 'ecp_sid')!.value}`;

  const batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const file = (await h.uploadFile(batchId, PDF, '묶음.pdf', 2)).json();
  await h.uploadPage(file.fileId, 1, cert('오호영', '총무과', '2026년 성희롱 예방교육', '2026. 3. 31.', '1시간'));
  await h.uploadPage(file.fileId, 2, cert('김재무', '재무과', '2026년 공직자 청렴교육', '2026. 5. 20.', '2시간'));
  await h.drainQueue();
  const drafts = (await h.send('GET', '/api/certificates?status=draft')).json() as CertificateListItem[];
  expect((await h.send('POST', '/api/certificates/bulk-confirm', { ids: drafts.map((d) => d.id) })).json()).toMatchObject({ confirmed: 2 });
});

afterAll(async () => {
  await h.close();
});

let analysis: FormAnalysis;
let shared: FormTemplate;

describe('양식 올리기·저장', () => {
  it('두 줄 머리글 양식의 자리와 열을 찾는다', async () => {
    const res = await upload(await formTwoRowHeader(), '제출양식.xlsx');
    expect(res.statusCode).toBe(200);
    analysis = res.json();
    expect(analysis.layout).toEqual({ sheetName: '제출양식', headerFirst: 4, headerLast: 5, dataFirst: 6, footerRow: 11 });
    expect(analysis.placeholders.sort()).toEqual(['부서명', '작성일']);
    expect(analysis.columns.map((c) => c.label)).toContain('성희롱 예방교육 › 이수일');
    expect(analysis.columns.find((c) => c.letter === 'D')!.fill).toEqual({ kind: 'person', field: 'name' });
    expect(analysis.columns.find((c) => c.letter === 'G')!.fill).toMatchObject({ kind: 'training', format: 'mark' });
  });

  it('옛 엑셀(.xls)·엑셀이 아닌 파일은 고치는 방법과 함께 거절한다', async () => {
    const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
    const res = await upload(xls, '옛양식.xls');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('.xlsx');
    expect((await upload(Buffer.from('hello'), '메모.txt')).statusCode).toBe(400);
  });

  it('미리보기는 첫 사람들을 양식 열에 맞춰 보여 준다', async () => {
    const preview = (await h.send('POST', '/api/forms/preview', { year: 2026, columns: analysis.columns, markStyle: 'ox' })).json() as FormPreview;
    expect(preview.total).toBe(3);
    const nameCol = analysis.columns.findIndex((c) => c.letter === 'D');
    const dateCol = analysis.columns.findIndex((c) => c.letter === 'E');
    const row = preview.rows.find((r) => r[nameCol] === '오호영')!;
    expect(row[dateCol]).toBe('2026.03.31');
  });

  it('관리자는 공용 양식으로 저장하고, 서무도 공용 양식을 본다(고치지는 못함)', async () => {
    const res = await h.send('POST', '/api/forms', {
      uploadId: analysis.uploadId,
      name: '기관 공통 제출 양식',
      departmentId: null,
      layout: analysis.layout,
      columns: analysis.columns,
      markStyle: 'ox',
    });
    expect(res.statusCode).toBe(200);
    shared = res.json();
    expect(shared).toMatchObject({ name: '기관 공통 제출 양식', departmentId: null, canEdit: true });

    const clerkList = (await as(clerkCookie, 'GET', '/api/forms')).json() as FormTemplate[];
    expect(clerkList.map((f) => [f.name, f.canEdit])).toEqual([['기관 공통 제출 양식', false]]);
    const save = { name: '바꾼 이름', departmentId: null, layout: shared.layout, columns: shared.columns, markStyle: 'ox' };
    expect((await as(clerkCookie, 'PUT', `/api/forms/${shared.id}`, save)).statusCode).toBe(403);
    expect((await as(clerkCookie, 'DELETE', `/api/forms/${shared.id}`)).statusCode).toBe(403);
  });

  it('서무는 담당 부서 양식만 만든다', async () => {
    const mine = (await upload(await formTwoRowHeader(), '총무.xlsx', clerkCookie)).json() as FormAnalysis;
    const body = (departmentId: number | null) => ({ uploadId: mine.uploadId, name: '총무과 양식', departmentId, layout: mine.layout, columns: mine.columns, markStyle: 'circle' });
    expect((await as(clerkCookie, 'POST', '/api/forms', body(null))).statusCode).toBe(403);
    expect((await as(clerkCookie, 'POST', '/api/forms', body(financeId))).statusCode).toBe(403);
    const ok = await as(clerkCookie, 'POST', '/api/forms', body(generalId));
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ departmentName: '총무과', canEdit: true, markStyle: 'circle' });
    // 관리자 목록에는 둘 다
    expect(((await h.send('GET', '/api/forms')).json() as FormTemplate[]).map((f) => f.name).sort()).toEqual(['기관 공통 제출 양식', '총무과 양식']);
  });
});

describe('양식에 채워 받기', () => {
  it('사유가 없으면 받을 수 없다', async () => {
    expect((await h.send('GET', `/api/exports/form?year=2026&formId=${shared.id}`)).statusCode).toBe(400);
  });

  it('전체 부서를 한 파일에: 양식 모양 그대로, 이수 현황 순서로 쓰고 감사 로그에 남긴다', async () => {
    const res = await h.send('GET', `/api/exports/form?year=2026&formId=${shared.id}&reason=${REASON}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('2026년_기관 공통 제출 양식'));
    const ws = await readSheet(res.rawPayload);
    expect([6, 7, 8].map((r) => ws.getCell(`D${r}`).value)).toEqual(['송주주', '오호영', '김재무']);
    expect(ws.getCell('C6').value).toBe('행정8급');
    expect(ws.getCell('A2').value).toContain('부서명: 전체 부서');
    expect((ws.getCell('E7').value as Date).toISOString().slice(0, 10)).toBe('2026-03-31'); // 날짜 서식 칸이라 날짜로
    expect(ws.getCell('G8').value).toBe('O'); // 김재무 청렴 이수
    expect(ws.getCell('G6').value).toBe('X');
    expect(ws.getCell('D11').value).toMatchObject({ formula: 'COUNTA(D6:D10)' }); // 3명 < 빈 줄 5개라 줄을 끼우지 않음

    const logs = (await h.send('GET', '/api/audit?category=export')).json() as AuditPage;
    expect(logs.entries.find((i) => i.action === 'export.form')!.detail).toMatchObject({ form: '기관 공통 제출 양식', employees: 3, reason: '감사·점검 제출' });
  });

  it('부서별로 나누면 부서마다 파일을 ZIP으로', async () => {
    const res = await h.send('GET', `/api/exports/form?year=2026&formId=${shared.id}&split=1&reason=${REASON}`);
    expect(res.headers['content-type']).toBe('application/zip');
    const names = [...res.rawPayload.toString('latin1').matchAll(/2026[^\0]*?\.xlsx/g)].map((m) => Buffer.from(m[0], 'latin1').toString('utf8'));
    expect(new Set(names)).toEqual(new Set(['2026년_기관 공통 제출 양식_총무과.xlsx', '2026년_기관 공통 제출 양식_재무과.xlsx']));
  });

  it('서무는 담당 부서 직원만 채운다', async () => {
    const res = await as(clerkCookie, 'GET', `/api/exports/form?year=2026&formId=${shared.id}&reason=${REASON}`);
    const ws = await readSheet(res.rawPayload);
    expect([6, 7, 8].map((r) => ws.getCell(`D${r}`).value)).toEqual(['송주주', '오호영', null]);
    expect(ws.getCell('A2').value).toContain('부서명: 총무과');
  });

  it('미이수·부분이수만 고를 수 있다', async () => {
    const res = await h.send('GET', `/api/exports/form?year=2026&formId=${shared.id}&onlyMissing=1&reason=${REASON}`);
    expect(res.statusCode).toBe(200); // 셋 다 남은 교육이 있다
  });

  it('올린 빈 양식을 그대로 받을 수 있다', async () => {
    const res = await h.send('GET', `/api/forms/${shared.id}/file`);
    const ws = await readSheet(res.rawPayload);
    expect(ws.getCell('A1').value).toBe('2026년 법정의무교육 이수 현황');
    expect(ws.getCell('D6').value).toBeNull();
  });
});
