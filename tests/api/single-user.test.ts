import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/src/app.ts';
import { APP_ROOT, assertSingleUserHost, loadConfig } from '../../server/src/config.ts';
import { runMigrations } from '../../server/src/db/migrate.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';
import { createHarness, type Harness } from './harness.ts';

// 단일 사용자 모드(시범 서버 전용): 앱 로그인 없이 nginx 로그인 하나로만 보호하는 모드

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** 로그인(세션 쿠키) 없이 보내는 요청. 화면이 붙이는 x-requested-with 헤더는 붙인다 */
function anon(h: Harness, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = { 'x-requested-with': 'fetch' }) {
  return h.app.inject({ method, url, payload: payload as object, headers });
}

describe('단일 사용자 모드 꺼짐 (기본)', () => {
  it('기존처럼 로그인이 있어야 한다', async () => {
    harness = await createHarness(); // 첫 관리자는 만들었지만 쿠키 없이 보낸다
    expect((await anon(harness, 'GET', '/api/employees')).statusCode).toBe(401);
    expect((await anon(harness, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await anon(harness, 'GET', '/api/meta')).json()).toMatchObject({ needsSetup: false, singleUser: false });
  });

  it('설정을 안 하면 꺼져 있다', () => {
    expect(loadConfig({}).singleUser).toBe(false);
  });
});

describe('단일 사용자 모드 켜짐', () => {
  it('로그인 없이도 /api/employees가 200이고, 첫 관리자로 처리된다', async () => {
    harness = await createHarness({ singleUser: true });
    const employees = await anon(harness, 'GET', '/api/employees');
    expect(employees.statusCode).toBe(200);

    const me = await anon(harness, 'GET', '/api/auth/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ loginId: 'admin', role: 'admin', mustChangePassword: false });
    expect((await anon(harness, 'GET', '/api/users')).statusCode).toBe(200); // 관리자 전용 API도
    expect((await anon(harness, 'GET', '/api/meta')).json()).toMatchObject({ singleUser: true });
  });

  it('비밀번호를 바꿔야 하는 관리자라도 막지 않는다', async () => {
    harness = await createHarness({ singleUser: true });
    await harness.db.updateTable('users').set({ must_change_password: 1 }).execute();
    expect((await anon(harness, 'GET', '/api/employees')).statusCode).toBe(200);
    expect((await anon(harness, 'GET', '/api/auth/me')).json()).toMatchObject({ mustChangePassword: false });
  });

  it('데이터를 바꾸는 요청은 여전히 x-requested-with 헤더가 있어야 한다', async () => {
    harness = await createHarness({ singleUser: true });
    const body = { name: '총무과' };
    const withoutHeader = await anon(harness, 'POST', '/api/departments', body, {});
    expect(withoutHeader.statusCode).toBe(403);
    expect(withoutHeader.json().error.message).toContain('허용되지 않은 요청');
    expect((await anon(harness, 'POST', '/api/departments', body)).statusCode).toBe(200);
  });

  it('사용 중인 관리자 가운데 가장 먼저 만든 계정을 쓴다', async () => {
    harness = await createHarness({ singleUser: true });
    const { db } = harness;
    await db.insertInto('users').values({ login_id: 'second', name: '둘째', role: 'admin', password_hash: 'x' }).execute();
    await db.insertInto('users').values({ login_id: 'clerk1', name: '서무', role: 'clerk', password_hash: 'x' }).execute();
    expect((await anon(harness, 'GET', '/api/auth/me')).json()).toMatchObject({ loginId: 'admin' });

    await db.updateTable('users').set({ active: 0 }).where('login_id', '=', 'admin').execute(); // 첫 관리자를 끄면 다음 관리자
    expect((await anon(harness, 'GET', '/api/auth/me')).json()).toMatchObject({ loginId: 'second' });

    await db.updateTable('users').set({ active: 0 }).where('login_id', '=', 'second').execute(); // 서무만 남으면 자동 입장 없음
    expect((await anon(harness, 'GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await anon(harness, 'GET', '/api/employees')).statusCode).toBe(401);
  });

  it('유효하지 않은 세션 쿠키가 있어도 첫 관리자로 들어간다', async () => {
    harness = await createHarness({ singleUser: true });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-requested-with': 'fetch', cookie: 'ecp_sid=expired-or-unknown' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ loginId: 'admin' });
  });

  it('비밀번호 변경은 막고, 최초 설정은 관리자가 있으면 열리지 않는다', async () => {
    harness = await createHarness({ singleUser: true });
    const change = await anon(harness, 'POST', '/api/auth/password', { currentPassword: 'Garam1234!', newPassword: 'Garam5678!' });
    expect(change.statusCode).toBe(403);
    expect(change.json().error.message).toContain('단일 사용자 모드');

    const setup = await anon(harness, 'POST', '/api/setup', { orgName: 'x', loginId: 'other', name: 'x', password: 'Garam1234!' });
    expect(setup.statusCode).toBe(409);
    expect((await anon(harness, 'GET', '/api/meta')).json()).toMatchObject({ needsSetup: false });
  });

  it('관리자가 아직 없으면 최초 설정 화면으로 보낸다 (자동 입장 없음)', async () => {
    const { db, raw } = (() => {
      const opened = openDatabase(':memory:');
      runMigrations(opened.raw);
      return opened;
    })();
    const app = await buildApp({ db, config: { ...loadConfig({}), singleUser: true, webDistDir: '/nonexistent' }, version: 'test' }, { logger: false });
    const headers = { 'x-requested-with': 'fetch' };
    expect((await app.inject({ method: 'GET', url: '/api/meta', headers })).json()).toMatchObject({ needsSetup: true, singleUser: true });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode).toBe(401);
    await app.close();
    raw.close();
  });

  it('시스템 점검에 단일 사용자 모드 경고가 나온다', async () => {
    harness = await createHarness({ singleUser: true });
    const sys = (await anon(harness, 'GET', '/api/system')).json() as { warnings: string[] };
    expect(sys.warnings.some((w) => w.includes('단일 사용자 모드'))).toBe(true);
  });
});

describe('단일 사용자 모드 안전장치: host가 서버 안이 아니면 시작하지 않는다', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** config.json을 임시 폴더에 쓰고 그 경로를 돌려준다 */
  function writeConfig(content: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'ecp-config-'));
    dirs.push(dir);
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(content));
    return file;
  }

  it('config.json의 singleUser를 읽고, host를 안 정하면 127.0.0.1이라 켤 수 있다', () => {
    const config = loadConfig({ ECP_CONFIG: writeConfig({ singleUser: true }) });
    expect(config).toMatchObject({ singleUser: true, host: '127.0.0.1' });
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('host가 %s이면 켤 수 있다', (host) => {
    expect(loadConfig({ ECP_CONFIG: writeConfig({ singleUser: true, host }) }).singleUser).toBe(true);
  });

  it.each(['0.0.0.0', '::', '10.1.2.3', '192.168.0.10', 'edu.example.go.kr'])('host가 %s이면 설정을 읽는 단계에서 거부한다', (host) => {
    expect(() => loadConfig({ ECP_CONFIG: writeConfig({ singleUser: true, host }) })).toThrow(/단일 사용자 모드.*127\.0\.0\.1/);
  });

  it('환경 변수 HOST로 바깥 주소를 줘도 거부한다', () => {
    const ECP_CONFIG = writeConfig({ singleUser: true });
    expect(() => loadConfig({ ECP_CONFIG, HOST: '0.0.0.0' })).toThrow(/단일 사용자 모드/);
  });

  it('꺼져 있으면 host는 아무 값이나 된다 (기존 동작)', () => {
    expect(loadConfig({ ECP_CONFIG: writeConfig({ host: '0.0.0.0' }) })).toMatchObject({ singleUser: false, host: '0.0.0.0' });
    expect(loadConfig({ ECP_CONFIG: writeConfig({ singleUser: false, host: '0.0.0.0' }) }).singleUser).toBe(false);
  });

  it('true·false가 아닌 값("true" 글자 등)은 켜짐으로 읽지 않고 오류로 멈춘다', () => {
    for (const singleUser of ['true', 'false', 1, 0, null]) {
      expect(() => loadConfig({ ECP_CONFIG: writeConfig({ singleUser }) })).toThrow(/singleUser/);
    }
  });

  it('앱을 만들 때도 한 번 더 막는다 (설정을 직접 넘기는 경우)', async () => {
    expect(() => assertSingleUserHost({ singleUser: true, host: '0.0.0.0' })).toThrow(/단일 사용자 모드/);
    expect(() => assertSingleUserHost({ singleUser: true, host: ' LocalHost ' })).not.toThrow();
    expect(() => assertSingleUserHost({ singleUser: false, host: '0.0.0.0' })).not.toThrow();

    const { db } = openDatabase(':memory:');
    const config = { ...loadConfig({}), singleUser: true, host: '0.0.0.0', webDistDir: '/nonexistent' };
    await expect(buildApp({ db, config, version: 'test' }, { logger: false })).rejects.toThrow(/단일 사용자 모드/);
  });

  it('서버 프로그램을 실제로 켜 보면 오류를 내고 멈춘다', () => {
    const ECP_CONFIG = writeConfig({ singleUser: true, host: '0.0.0.0', port: 0 });
    const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(APP_ROOT, 'server', 'src', 'index.ts')], {
      env: { ...process.env, ECP_CONFIG },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('단일 사용자 모드');
  }, 90_000);
});
