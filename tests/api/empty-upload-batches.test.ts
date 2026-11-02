import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { verifyChain } from '../../server/src/lib/logChain.ts';
import { createHarness, multipart, PDF, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.close(); });
const createBatch = async () => (await h.send('POST', '/api/batches', { year: 2026 })).json().id as number;
const removeEmpty = (id: number) => h.send('DELETE', `/api/batches/${id}/empty`);
const rows = () => h.db.selectFrom('batches').selectAll().orderBy('id').execute();

it('중복 파일만 올린 새 묶음은 목록에서 지우고 기존 파일과 처리 기록은 보존한다', async () => {
  const original = await createBatch();
  const content = Buffer.concat([PDF, Buffer.from('duplicate-only')]);
  const file = (await h.uploadFile(original, content, '수료증.pdf')).json().fileId;
  await h.uploadPage(file, 1, '교육자료 표지입니다.');
  expect(await h.drainQueue()).toEqual([]);
  const before = { files: await h.db.selectFrom('files').selectAll().execute(), pages: await h.db.selectFrom('pages').selectAll().execute(), certificates: await h.db.selectFrom('certificates').selectAll().execute() };
  const bytes = readFileSync(join(h.dataDir, 'files', before.files[0].stored_name));
  const empty = await createBatch();
  expect((await h.uploadFile(empty, content, '이름을바꾼수료증.pdf')).json()).toMatchObject({ fileId: null, duplicateOf: { batchId: original } });
  expect((await removeEmpty(empty)).json()).toEqual({ deleted: true });
  expect((await h.send('GET', '/api/batches')).json().map((b: { id: number }) => b.id)).toEqual([original]);
  expect(await h.db.selectFrom('files').selectAll().execute()).toEqual(before.files);
  expect(await h.db.selectFrom('pages').selectAll().execute()).toEqual(before.pages);
  expect(await h.db.selectFrom('certificates').selectAll().execute()).toEqual(before.certificates);
  expect(readFileSync(join(h.dataDir, 'files', before.files[0].stored_name))).toEqual(bytes);
  const log = await h.db.selectFrom('audit_log').selectAll().where('action', '=', 'batch.empty-delete').executeTakeFirstOrThrow();
  expect(log).toMatchObject({ user_login: 'admin', target_type: 'batch', target_id: String(empty) });
  expect(JSON.parse(log.detail!)).toEqual({ year: 2026 });
  expect((await verifyChain(h.db, 'audit_log')).ok).toBe(true);
});

it('쪽을 올리지 못했어도 원본 파일이 하나라도 있는 묶음은 지우지 않는다', async () => {
  const id = await createBatch();
  await h.uploadFile(id, Buffer.concat([PDF, Buffer.from('original-only')]), '쪽읽기실패.pdf');
  const before = await rows();
  const files = await h.db.selectFrom('files').selectAll().execute();
  const bytes = readFileSync(join(h.dataDir, 'files', files[0].stored_name));
  expect((await removeEmpty(id)).json()).toEqual({ deleted: false });
  expect(await rows()).toEqual(before);
  expect(await h.db.selectFrom('files').selectAll().execute()).toEqual(files);
  expect(readFileSync(join(h.dataDir, 'files', files[0].stored_name))).toEqual(bytes);
  expect(await h.db.selectFrom('audit_log').select('id').where('action', '=', 'batch.empty-delete').execute()).toEqual([]);
});

it('관리자도 다른 사용자가 만든 묶음을 지우지 못하고 서무도 본인 묶음만 정리한다', async () => {
  const adminBatch = await createBatch();
  const department = (await h.send('POST', '/api/departments', { name: '다른 부서' })).json().id;
  await h.send('POST', '/api/users', { loginId: 'clerk', name: '가상서무', role: 'clerk', password: 'Clerk1234!', departmentIds: [department] });
  const user = await h.db.selectFrom('users').select('id').where('login_id', '=', 'clerk').executeTakeFirstOrThrow();
  await h.db.updateTable('users').set({ must_change_password: 0 }).where('id', '=', user.id).execute();
  const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'clerk', password: 'Clerk1234!' }, headers: { 'x-requested-with': 'fetch' } });
  const headers = { 'x-requested-with': 'fetch', cookie: `ecp_sid=${login.cookies.find(c => c.name === 'ecp_sid')!.value}` };
  const clerkBatch = (await h.app.inject({ method: 'POST', url: '/api/batches', payload: { year: 2026 }, headers })).json().id;
  const before = await rows();
  expect((await removeEmpty(clerkBatch)).statusCode).toBe(403);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/batches/${adminBatch}/empty`, headers })).statusCode).toBe(403);
  expect(await rows()).toEqual(before);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/batches/${clerkBatch}/empty`, headers })).json()).toEqual({ deleted: true });
  expect((await rows()).map(b => b.id)).toEqual([adminBatch]);
});

it('로그인하지 않은 요청과 없는 묶음을 거부한다', async () => {
  const id = await createBatch();
  expect((await h.app.inject({ method: 'DELETE', url: `/api/batches/${id}/empty`, headers: { 'x-requested-with': 'fetch' } })).statusCode).toBe(401);
  expect((await removeEmpty(999999)).statusCode).toBe(404);
  expect((await rows()).map(b => b.id)).toEqual([id]);
});

it('원본 수신 중에는 빈 묶음 정리를 보류하고 수신한 파일과 묶음을 보존한다', async () => {
  const id = await createBatch();
  const body = multipart([{ name: 'pageCount', value: '1' }, { name: 'file', value: Buffer.concat([PDF, Buffer.from('delayed')]), filename: '수신중.pdf', type: 'application/pdf' }]);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const split = body.payload.length - 10;
  const payload = Readable.from((async function* () { yield body.payload.subarray(0, split); await gate; yield body.payload.subarray(split); })());
  const login = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { loginId: 'admin', password: 'Garam1234!' }, headers: { 'x-requested-with': 'fetch' } });
  const cookie = `ecp_sid=${login.cookies.find(c => c.name === 'ecp_sid')!.value}`;
  const upload = h.app.inject({ method: 'POST', url: `/api/batches/${id}/files`, payload, headers: { ...body.headers, 'x-requested-with': 'fetch', cookie } }).then(response => response);
  try {
    let receiving = false;
    for (let n = 0; n < 100; n++) {
      receiving = readdirSync(h.dataDir).includes('files') && readdirSync(join(h.dataDir, 'files')).some(name => name.startsWith('.upload-'));
      if (receiving) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    expect(receiving).toBe(true);
    expect((await removeEmpty(id)).json()).toEqual({ deleted: false });
  } finally { release(); }
  expect((await upload).statusCode).toBe(200);
  expect((await removeEmpty(id)).json()).toEqual({ deleted: false });
  const stored = await h.db.selectFrom('files').selectAll().execute();
  expect(stored).toHaveLength(1);
  expect(stored[0].batch_id).toBe(id);
  expect(readdirSync(join(h.dataDir, 'files'))).toEqual([stored[0].stored_name]);
  expect((await rows()).map(b => b.id)).toEqual([id]);
});
