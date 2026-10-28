import { inflateRawSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditPage, CertificateListItem, Dashboard, ExportSummary } from '../../shared/types.ts';
import { loadXlsx, sheetObjects, sheetRows } from '../fixtures-workbook.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

// 대시보드·내보내기(엑셀·ZIP·합본 PDF)·감사 로그. 받은 파일을 실제로 열어 내용까지 확인한다.

const REASON = encodeURIComponent('감사·점검 제출');
let h: Harness;
let clerkCookie = '';
let financeId: number;

const cert = (name: string, dept: string, course: string, date: string, hours: string) =>
  ['수 료 증', `성 명 : ${name}`, `소 속 : 가람시 ${dept}`, `과 정 명 : ${course}`, `이수일자 : ${date}`, `교육시간 : ${hours}`, '위 사람은 위 교육과정을 이수하였음을 증명합니다.', '가상인재개발원장'].join('\n');

/** 글자 정보가 있는 진짜 PDF (원본에서 쪽을 옮겨 오는 길을 시험) */
async function realPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595, 842]).drawText(`certificate page ${i}`, { x: 60, y: 760, size: 18, font });
  return Buffer.from(await doc.save());
}

/** ZIP 목록: 중앙 디렉터리를 읽어 이름·UTF-8 표시·내용을 꺼낸다 */
function readZip(buf: Buffer): { name: string; utf8: boolean; data: Buffer }[] {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    entries.push({ name, utf8: (flags & 0x0800) !== 0, data: method === 8 ? inflateRawSync(raw) : raw });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function get(url: string, cookie?: string) {
  return h.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : undefined }).then((r) => r);
}

beforeAll(async () => {
  h = await createHarness();
  const general = await h.db.insertInto('departments').values({ name: '총무과', sort_order: 1 }).returning('id').executeTakeFirstOrThrow();
  const finance = await h.db.insertInto('departments').values({ name: '재무과', sort_order: 2 }).returning('id').executeTakeFirstOrThrow();
  financeId = finance.id;
  await h.db
    .insertInto('employees')
    .values([
      { name: '오호영', name_key: '오호영', department_id: general.id, emp_no: '1001' },
      { name: '송주주', name_key: '송주주', department_id: general.id, emp_no: '1002' },
      { name: '김재무', name_key: '김재무', department_id: finance.id, emp_no: '2001' },
    ])
    .execute();

  // 총무과 서무 계정 (처음 로그인하면 비밀번호를 바꿔야 한다)
  await h.send('POST', '/api/users', { loginId: 'clerk1', name: '총무서무', role: 'clerk', departmentIds: [general.id], password: 'Clerk1234!' });
  const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk1', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
  const first = `ecp_sid=${login.cookies.find((c) => c.name === 'ecp_sid')!.value}`;
  const changed = await h.app.inject({
    method: 'POST',
    url: '/api/auth/password',
    payload: { currentPassword: 'Clerk1234!', newPassword: 'General5678!' },
    headers: { 'x-requested-with': 'fetch', cookie: first },
  });
  clerkCookie = `ecp_sid=${changed.cookies.find((c) => c.name === 'ecp_sid')!.value}`;

  // 진짜 PDF 2쪽(오호영 4대폭력 통합, 김재무 청렴) + 원본을 열 수 없는 PDF 1쪽(송주주 청렴)
  const batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
  const bundle = (await h.uploadFile(batchId, await realPdf(2), '스캔묶음.pdf', 2)).json();
  await h.uploadPage(bundle.fileId, 1, cert('오호영', '총무과', '2026년 4대폭력 예방 통합교육', '2026. 3. 31.', '4시간'));
  await h.uploadPage(bundle.fileId, 2, cert('김재무', '재무과', '2026년 공직자 청렴교육', '2026. 5. 20.', '2시간'));
  const broken = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from('x')]), '송주주:청렴?.pdf')).json();
  await h.uploadPage(broken.fileId, 1, cert('송주주', '총무과', '2026년 공직자 청렴교육', '2026. 6. 2.', '2시간'));
  await h.drainQueue();

  const drafts = (await h.send('GET', '/api/certificates?status=draft')).json() as CertificateListItem[];
  const result = (await h.send('POST', '/api/certificates/bulk-confirm', { ids: drafts.map((d) => d.id) })).json();
  expect(result).toMatchObject({ confirmed: 3, skipped: [] });
});

afterAll(async () => {
  await h.close();
});

describe('대시보드', () => {
  it('전체·부서별 이수율과 남은 직원을 센다', async () => {
    const d = (await h.send('GET', '/api/dashboard?year=2026')).json() as Dashboard;
    // 교육 7개(기본 사용) × 직원 3명 = 21칸 중 이수: 오호영 4 + 김재무 1 + 송주주 1
    expect(d.trainings).toHaveLength(7);
    expect(d.overall).toMatchObject({ target: 21, done: 6 });
    expect(d.employees).toEqual({ total: 3, complete: 0, missing: 3 });
    expect(d.drafts).toBe(0);
    expect(d.departments.map((x) => [x.name, x.employees, x.rate])).toEqual([
      ['총무과', 2, 5 / 14],
      ['재무과', 1, 1 / 7],
    ]);
  });

  it('서무는 담당 부서만 본다', async () => {
    const d = (await get('/api/dashboard?year=2026', clerkCookie)).json() as Dashboard;
    expect(d.departments.map((x) => x.name)).toEqual(['총무과']);
    expect(d.overall).toMatchObject({ target: 14, done: 5 });
  });
});

describe('내보내기', () => {
  it('요약: 확정 이수증 수와 교육별 파일 수', async () => {
    const s = (await h.send('GET', '/api/exports/summary?year=2026')).json() as ExportSummary;
    expect(s.certificates).toBe(3);
    expect(s.trainings.find((t) => t.name === '청렴교육(부패방지교육)')?.certificates).toBe(2);
    expect(s.trainings.find((t) => t.name === '성희롱 예방교육')?.certificates).toBe(1);
  });

  it('내려받을 때는 사유가 있어야 한다', async () => {
    const res = await h.send('GET', '/api/exports/status.xlsx?year=2026');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('사유');
  });

  it('이수 현황 엑셀: 시트 4개, 직원별 판정, 근거 이수증 목록', async () => {
    const res = await h.send('GET', `/api/exports/status.xlsx?year=2026&reason=${REASON}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain(encodeURIComponent('2026년_법정교육_이수현황'));
    const wb = await loadXlsx(res.rawPayload);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['요약', '직원별', '미이수자', '상세 내역']);

    // 머리글은 넷째 줄 (위에 제목·기준·빈 줄)
    const byEmployee = sheetObjects(wb.getWorksheet('직원별')!, 4);
    expect(byEmployee.map((r) => [r['부서'], r['성명'], r['성희롱 예방교육'], r['청렴교육(부패방지교육)']])).toEqual([
      ['총무과', '송주주', '미이수', '이수'],
      ['총무과', '오호영', '이수', '미이수'],
      ['재무과', '김재무', '미이수', '이수'],
    ]);
    const missing = sheetObjects(wb.getWorksheet('미이수자')!, 4);
    expect(missing).toHaveLength(21 - 6);
    const detail = sheetObjects(wb.getWorksheet('상세 내역')!, 4);
    expect(detail).toHaveLength(6); // 통합교육 1장이 4줄 + 청렴 2장
    expect(detail[0]).toMatchObject({ 부서: '총무과', 성명: '송주주', 교육: '청렴교육(부패방지교육)', '원본 파일': '송주주:청렴?.pdf' });
    const summary = sheetRows(wb.getWorksheet('요약')!);
    expect(String(summary[0][0])).toContain('2026년 법정교육 이수 현황');
  });

  it('이수증 ZIP: 교육별 폴더, Windows에서 쓸 수 있는 한글 이름(UTF-8 표시), 열리는 PDF', async () => {
    const res = await h.send('GET', `/api/exports/certificates.zip?year=2026&layout=training&reason=${REASON}`);
    expect(res.statusCode).toBe(200);
    const entries = readZip(res.rawPayload);
    expect(entries.map((e) => e.name).sort()).toEqual(
      [
        '가정폭력 예방교육/총무과_오호영_가정폭력 예방교육_2026-03-31.pdf',
        '성매매 예방교육/총무과_오호영_성매매 예방교육_2026-03-31.pdf',
        '성폭력 예방교육/총무과_오호영_성폭력 예방교육_2026-03-31.pdf',
        '성희롱 예방교육/총무과_오호영_성희롱 예방교육_2026-03-31.pdf',
        '청렴교육(부패방지교육)/재무과_김재무_청렴교육(부패방지교육)_2026-05-20.pdf',
        '청렴교육(부패방지교육)/총무과_송주주_청렴교육(부패방지교육)_2026-06-02.pdf',
      ].sort(),
    );
    expect(entries.every((e) => e.utf8)).toBe(true);
    for (const e of entries) expect((await PDFDocument.load(e.data)).getPageCount()).toBe(1);

    const byDept = readZip((await h.send('GET', `/api/exports/certificates.zip?year=2026&layout=department&reason=${REASON}`)).rawPayload);
    expect(new Set(byDept.map((e) => e.name.split('/')[0]))).toEqual(new Set(['총무과', '재무과']));
  });

  it('교육별 합본 PDF: 그 교육의 이수증을 부서·성명 순서로 모은다', async () => {
    const s = (await h.send('GET', '/api/exports/summary?year=2026')).json() as ExportSummary;
    const integrity = s.trainings.find((t) => t.name === '청렴교육(부패방지교육)')!;
    const res = await h.send('GET', `/api/exports/merged.pdf?year=2026&trainingId=${integrity.trainingId}&reason=${REASON}`);
    expect(res.statusCode).toBe(200);
    const doc = await PDFDocument.load(res.rawPayload);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getTitle()).toContain('청렴교육');

    const empty = s.trainings.find((t) => t.certificates === 0)!;
    expect((await h.send('GET', `/api/exports/merged.pdf?year=2026&trainingId=${empty.trainingId}&reason=${REASON}`)).statusCode).toBe(400);
  });

  it('개인별 합본은 제목을 바꾸고, 통합과정의 같은 이수증을 한 번만 담는다', async () => {
    const title = encodeURIComponent('제출용_{연도}_{성명}');
    const result = await h.send('GET', `/api/exports/employees.zip?year=2026&reason=${REASON}&title=${title}&archiveTitle=${encodeURIComponent('기관제출')}`);
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-disposition']).toContain(encodeURIComponent('기관제출.zip'));
    const entries = readZip(result.rawPayload);
    expect(entries.map(e => e.name).sort()).toEqual(['제출용_2026_김재무.pdf', '제출용_2026_송주주.pdf', '제출용_2026_오호영.pdf']);
    for (const entry of entries) {
      const pdf = await PDFDocument.load(entry.data);
      expect(pdf.getPageCount()).toBe(1);
      expect(pdf.getTitle()).toBe(entry.name.replace(/\.pdf$/, ''));
    }
    const duplicate = await h.send('GET', `/api/exports/employees.zip?year=2026&reason=${REASON}&title=${encodeURIComponent('../CON')}`);
    const names = readZip(duplicate.rawPayload).map(e => e.name);
    expect(new Set(names).size).toBe(3);
    expect(names.every(name => !name.includes('/'))).toBe(true);
  });

  it('개인별 내보내기도 서무 범위와 사유를 확인한다', async () => {
    const zip = readZip((await get(`/api/exports/employees.zip?year=2026&reason=${REASON}`, clerkCookie)).rawPayload);
    expect(zip).toHaveLength(2);
    expect(zip.every(e => e.name.includes('총무과'))).toBe(true);
    const finance = (await h.send('GET', '/api/employees')).json().find((e: { name: string }) => e.name === '김재무');
    expect((await get(`/api/exports/employees.zip?year=2026&reason=${REASON}&employeeId=${finance.id}`, clerkCookie)).statusCode).toBe(400);
    expect((await h.send('GET', '/api/exports/employees.zip?year=2026')).statusCode).toBe(400);
    expect((await h.send('GET', `/api/exports/employees.zip?year=2026&reason=${REASON}&title=${encodeURIComponent('{알수없는항목}')}`)).statusCode).toBe(400);
  });

  it('서무는 담당 부서 것만 받고, 다른 부서를 고르면 거절한다', async () => {
    const s = (await get('/api/exports/summary?year=2026', clerkCookie)).json() as ExportSummary;
    expect(s.certificates).toBe(2);
    const zip = readZip((await get(`/api/exports/certificates.zip?year=2026&layout=department&reason=${REASON}`, clerkCookie)).rawPayload);
    expect(zip.every((e) => e.name.startsWith('총무과/'))).toBe(true);
    expect((await get(`/api/exports/status.xlsx?year=2026&departmentId=${financeId}&reason=${REASON}`, clerkCookie)).statusCode).toBe(403);
  });
});

describe('감사 로그', () => {
  it('내보내기 기록을 남기고, 관리자만 찾아본다', async () => {
    const page = (await h.send('GET', '/api/audit?category=export')).json() as AuditPage;
    expect(page.entries.map((e) => e.action)).toEqual(expect.arrayContaining(['export.excel', 'export.zip', 'export.pdf']));
    expect(page.entries.find((e) => e.userLogin === 'clerk1')).toMatchObject({ userName: '총무서무', action: 'export.zip' });
    expect(page.entries.find((e) => e.action === 'export.excel')?.detail).toMatchObject({ year: 2026, scope: '전체 부서', reason: '감사·점검 제출' });

    const byUser = (await h.send('GET', '/api/audit?user=clerk1')).json() as AuditPage;
    expect(byUser.entries.every((e) => e.userLogin === 'clerk1')).toBe(true);
    expect(byUser.total).toBeGreaterThan(0);
    const future = (await h.send('GET', '/api/audit?from=2099-01-01')).json() as AuditPage;
    expect(future.total).toBe(0);
    expect((await get('/api/audit', clerkCookie)).statusCode).toBe(403);
  });
});
