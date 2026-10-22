import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildApp } from '../../server/src/app.ts';
import { loadConfig } from '../../server/src/config.ts';
import { runMigrations } from '../../server/src/db/migrate.ts';
import { seedDefaults } from '../../server/src/db/seed.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';

// 메모리 DB로 서버를 띄워 로그인·권한·명단 등록 흐름을 확인한다

let app: FastifyInstance;

beforeAll(async () => {
  const { raw, db } = openDatabase(':memory:');
  runMigrations(raw);
  await seedDefaults(db);
  const config = { ...loadConfig({}), webDistDir: '/nonexistent' };
  app = await buildApp({ db, config, version: 'test' }, { logger: false });
});

afterAll(async () => {
  await app.close();
});

/** 로그인한 사람처럼 요청을 보내는 도우미 */
function client(cookie = '') {
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      payload: payload as object,
      headers: { 'x-requested-with': 'fetch', ...(cookie ? { cookie } : {}) },
    });
  return {
    cookie,
    get: (url: string) => send('GET', url),
    post: (url: string, body: unknown = {}) => send('POST', url, body),
    patch: (url: string, body: unknown) => send('PATCH', url, body),
  };
}

function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'ecp_sid');
  if (!cookie) throw new Error('세션 쿠키가 없습니다');
  return `ecp_sid=${cookie.value}`;
}

let admin: ReturnType<typeof client>;
let financeId: number;

describe('초기 설정과 로그인', () => {
  it('처음에는 초기 설정이 필요하다고 알려 준다', async () => {
    const res = await client().get('/api/meta');
    expect(res.json()).toMatchObject({ needsSetup: true });
  });

  it('약한 비밀번호로는 설정할 수 없다', async () => {
    const res = await client().post('/api/setup', { orgName: '가람시', loginId: 'admin', name: '관리자', password: 'abc' });
    expect(res.statusCode).toBe(400);
  });

  it('관리자 계정을 만들고 바로 로그인된다', async () => {
    const res = await client().post('/api/setup', {
      orgName: '가람시',
      loginId: 'admin',
      name: '관리자',
      password: 'Garam1234!',
    });
    expect(res.statusCode).toBe(200);
    admin = client(sessionCookie(res));
    const me = await admin.get('/api/auth/me');
    expect(me.json()).toMatchObject({ loginId: 'admin', role: 'admin' });
  });

  it('두 번째 초기 설정은 거부한다', async () => {
    const res = await client().post('/api/setup', { orgName: 'x', loginId: 'other', name: 'x', password: 'Garam1234!' });
    expect(res.statusCode).toBe(409);
  });

  it('우리 화면이 붙이는 헤더가 없는 요청은 막는다', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'admin', password: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('비밀번호를 5번 틀리면 잠근다', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await client().post('/api/auth/login', { loginId: 'admin', password: 'wrong-password' });
      expect(res.statusCode).toBe(401);
    }
    const locked = await client().post('/api/auth/login', { loginId: 'admin', password: 'Garam1234!' });
    expect(locked.statusCode).toBe(423);
  });
});

describe('명단 일괄 등록과 서무 권한', () => {
  it('엑셀 명단을 읽고, 미리보고, 반영한다', async () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['직원 현황'],
      [],
      ['사번', '성명', '소속', '직급'],
      ['1001', '홍길동', '총무과', '7급'],
      ['1002', '이몽룡', '재무과', '8급'],
      ['1003', '성춘향', '재무과', '9급'],
    ]);
    XLSX.utils.book_append_sheet(book, sheet, '명단');
    const file: Buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });

    const boundary = '----roster';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="명단.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const parsed = await app.inject({
      method: 'POST',
      url: '/api/employees/import/parse',
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-requested-with': 'fetch', cookie: admin.cookie },
    });
    expect(parsed.statusCode).toBe(200);
    const result = parsed.json();
    expect(result.headerRowIndex).toBe(2);
    expect(result.mapping).toMatchObject({ empNo: 0, name: 1, department: 2, position: 3 });

    const options = { importId: result.importId, sheetIndex: 0, headerRowIndex: 2, mapping: result.mapping, retireMissing: false };
    const preview = await admin.post('/api/employees/import/preview', options);
    expect(preview.json().counts).toMatchObject({ new: 3, error: 0 });
    expect(preview.json().newDepartments).toEqual(['총무과', '재무과']);

    const applied = await admin.post('/api/employees/import/apply', options);
    expect(applied.json()).toMatchObject({ created: 3, departmentsCreated: 2 });

    const departments = (await admin.get('/api/departments')).json() as { id: number; name: string }[];
    financeId = departments.find((d) => d.name === '재무과')!.id;
  });

  it('서무는 담당 부서 직원만 보고, 관리자 기능은 쓸 수 없다', async () => {
    const created = await admin.post('/api/users', {
      loginId: 'clerk1',
      name: '김서무',
      role: 'clerk',
      password: 'Clerk1234!',
      departmentIds: [financeId],
    });
    expect(created.statusCode).toBe(200);

    const login = await client().post('/api/auth/login', { loginId: 'clerk1', password: 'Clerk1234!' });
    const clerk = client(sessionCookie(login));

    // 처음 받은 비밀번호로는 비밀번호 변경 말고는 할 수 없다
    expect((await clerk.get('/api/employees')).statusCode).toBe(403);
    const changed = await clerk.post('/api/auth/password', { currentPassword: 'Clerk1234!', newPassword: 'Finance5678!' });
    expect(changed.statusCode).toBe(200);
    const clerkAfter = client(sessionCookie(changed));

    const employees = (await clerkAfter.get('/api/employees')).json() as { name: string; departmentName: string }[];
    expect(employees.map((e) => e.name).sort()).toEqual(['성춘향', '이몽룡']);
    expect(employees.every((e) => e.departmentName === '재무과')).toBe(true);

    expect((await clerkAfter.get('/api/users')).statusCode).toBe(403);
    const otherDept = (await admin.get('/api/departments')).json().find((d: { name: string }) => d.name === '총무과');
    const forbidden = await clerkAfter.post('/api/employees', { name: '변학도', departmentId: otherDept.id });
    expect(forbidden.statusCode).toBe(403);
    const allowed = await clerkAfter.post('/api/employees', { name: '변학도', departmentId: financeId, birthDate: '700101' });
    expect(allowed.statusCode).toBe(200);
  });
});
