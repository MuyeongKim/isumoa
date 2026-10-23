import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CertificateDetail, CertificateListItem, StatusReport } from '../../shared/types.ts';
import type { DB } from '../../server/src/db/schema.ts';
import { claimNextJob, failJob, recoverInterruptedJobs, startWorker } from '../../server/src/jobs/queue.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

// 이수증 올리기 → 처리 → 검수 → 확정 → 이수 현황까지 서버 흐름을 확인한다 (AI 꺼짐: 규칙으로만 읽음).

let h: Harness;
let app: FastifyInstance;
let db: Kysely<DB>;
const send: Harness['send'] = (...args) => h.send(...args);
const uploadFile: Harness['uploadFile'] = (...args) => h.uploadFile(...args);
const uploadPage: Harness['uploadPage'] = (...args) => h.uploadPage(...args);
const drainQueue = () => h.drainQueue();

const TEXT_CERT = [
  '수 료 증',
  '성 명 : 오호영',
  '생년월일 : 1981. 10. 22.',
  '소 속 : 가람시 총무과',
  '과 정 명 : 2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)',
  '교육기간 : 2026. 3. 2. ~ 2026. 3. 31.',
  '교육시간 : 4시간',
  '위 사람은 위 교육과정을 이수하였기에 이 증서를 수여합니다.',
  '2026년 3월 31일',
  '가상인재개발원장',
].join('\n');

beforeAll(async () => {
  h = await createHarness();
  ({ app, db } = h);
  const dept = await db.insertInto('departments').values({ name: '총무과' }).returning('id').executeTakeFirstOrThrow();
  await db
    .insertInto('employees')
    .values([
      { name: '오호영', name_key: '오호영', department_id: dept.id, birth_date: '1981-10-22', emp_no: '1001' },
      { name: '송주주', name_key: '송주주', department_id: dept.id, birth_date: '1974-08-25', emp_no: '1002' },
    ])
    .execute();
});

afterAll(async () => {
  await h.close();
});

let batchId: number;
let firstId: number;

describe('이수증 올리기와 처리', () => {
  it('글자 정보가 있는 PDF는 OCR 없이 읽어 검수 대기로 만든다', async () => {
    batchId = (await send('POST', '/api/batches', { year: 2026, title: '상반기' })).json().id;
    const file = (await uploadFile(batchId, Buffer.concat([PDF, Buffer.from('a')]), '오호영_폭력예방.pdf')).json();
    expect(file).toMatchObject({ duplicateOf: null, uploadedPages: [] });
    await uploadPage(file.fileId, 1, TEXT_CERT);
    await drainQueue();

    const list = (await send('GET', `/api/certificates?batchId=${batchId}`)).json() as CertificateListItem[];
    expect(list).toHaveLength(1);
    firstId = list[0].id;
    expect(list[0]).toMatchObject({ status: 'draft', route: 'text', personName: '오호영', completedOn: '2026-03-31', hours: 4 });
    expect(list[0].employee?.name).toBe('오호영');
    expect(list[0].trainingIds).toHaveLength(4);
    expect(list[0].flags.filter((f) => f.level === 'error')).toEqual([]);
  });

  it('같은 파일을 다시 올리면 이어 올리기, 다른 묶음이면 중복으로 알려 준다', async () => {
    const again = (await uploadFile(batchId, Buffer.concat([PDF, Buffer.from('a')]), '다시.pdf')).json();
    expect(again.uploadedPages).toEqual([1]);
    const otherBatch = (await send('POST', '/api/batches', { year: 2026 })).json().id;
    const dup = (await uploadFile(otherBatch, Buffer.concat([PDF, Buffer.from('a')]), '다시.pdf')).json();
    expect(dup).toMatchObject({ fileId: null, duplicateOf: { batchId, fileName: '오호영_폭력예방.pdf' } });
  });

  it('PDF·이미지가 아닌 파일은 받지 않는다', async () => {
    const res = await uploadFile(batchId, Buffer.from('hello'), 'a.pdf');
    expect(res.statusCode).toBe(400);
  });

  it('스캔본은 OCR로 읽고, 잘못 읽은 이름은 비슷한 이름으로 찾아 경고를 단다', async () => {
    h.ocr.text = '교 육 이 수 증\n성 명   오후영\n교육명 : 2026년 공직자 청렴교육\n교육일 : 2026.05.20 (2시간)\n가상청렴연수원장';
    const file = (await uploadFile(batchId, Buffer.concat([PDF, Buffer.from('b')]), '스캔.pdf')).json();
    await uploadPage(file.fileId, 1, '');
    await drainQueue();
    const list = (await send('GET', `/api/certificates?batchId=${batchId}&status=draft`)).json() as CertificateListItem[];
    const scanned = list.find((c) => c.route === 'ocr')!;
    expect(scanned.employee?.name).toBe('오호영');
    expect(scanned.flags.map((f) => f.code)).toEqual(expect.arrayContaining(['name-differs', 'ocr']));
  });
});

describe('검수와 이수 판정', () => {
  it('확정하면 이수 현황에 반영되고, 과정명 → 교육 매핑을 기억한다', async () => {
    const detail = (await send('GET', `/api/certificates/${firstId}`)).json() as CertificateDetail;
    const res = await send('POST', `/api/certificates/${firstId}/confirm`, {
      employeeId: detail.employee!.id,
      credits: detail.credits,
      completedOn: detail.completedOn,
      hours: detail.hours,
      courseTitle: detail.courseTitle,
      provider: detail.provider,
      certNo: detail.certNo,
      year: detail.year,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'confirmed', confirmedBy: '관리자' });

    const status = (await send('GET', '/api/status?year=2026')).json() as StatusReport;
    const row = status.rows.find((r) => r.name === '오호영')!;
    const harassment = status.trainings.find((t) => t.code === 'sexual-harassment')!;
    const integrity = status.trainings.find((t) => t.code === 'integrity')!;
    expect(row.cells[harassment.id]).toMatchObject({ state: 'done', hours: 1 });
    expect(row.cells[integrity.id].state).toBe('none');
    expect(status.summary.find((s) => s.trainingId === harassment.id)).toMatchObject({ target: 2, done: 1, rate: 0.5 });

    const mappings = await db.selectFrom('course_mappings').selectAll().execute();
    expect(mappings).toHaveLength(4);
  });

  it('직원을 정하지 않으면 확정하지 않는다', async () => {
    const list = (await send('GET', `/api/certificates?batchId=${batchId}&status=draft`)).json() as CertificateListItem[];
    const res = await send('POST', `/api/certificates/${list[0].id}/confirm`, {
      employeeId: null,
      credits: [],
      completedOn: null,
      hours: null,
      courseTitle: null,
      provider: null,
      certNo: null,
      year: null,
    });
    expect(res.statusCode).toBe(422);
  });

  it('제외하고 다시 검수 대기로 되돌릴 수 있다', async () => {
    const list = (await send('GET', `/api/certificates?batchId=${batchId}&status=draft`)).json() as CertificateListItem[];
    const excluded = await send('POST', `/api/certificates/${list[0].id}/exclude`, { reason: '중복' });
    expect(excluded.json()).toMatchObject({ status: 'excluded', excludeReason: '중복' });
    const reopened = await send('POST', `/api/certificates/${list[0].id}/reopen`);
    expect(reopened.json().status).toBe('draft');
  });

  it('쪽 이미지는 로그인한 사람만 본다', async () => {
    const list = (await send('GET', `/api/certificates?batchId=${batchId}`)).json() as CertificateListItem[];
    const ok = await send('GET', `/api/pages/${list[0].pageId}/thumb`);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    const anonymous = await app.inject({ method: 'GET', url: `/api/pages/${list[0].pageId}/thumb` });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('처리 대기열', () => {
  it('처리 중에 꺼진 일은 다시 대기로 돌리고, 실패하면 나중에 다시 시도한다', async () => {
    const page = await db.selectFrom('pages').select('id').executeTakeFirstOrThrow();
    await db.insertInto('jobs').values({ kind: 'process-page', page_id: page.id }).execute();
    const job = (await claimNextJob(db))!;
    expect(job.attempts).toBe(1);
    expect(await claimNextJob(db)).toBeUndefined();

    expect(await recoverInterruptedJobs(db)).toBe(1);
    const again = (await claimNextJob(db))!;
    expect(again.id).toBe(job.id);

    expect(await failJob(db, again, 'OCR 실패')).toBe('retry');
    expect(await claimNextJob(db)).toBeUndefined(); // 10초 뒤에 다시
    const retried = await db.selectFrom('jobs').selectAll().where('id', '=', job.id).executeTakeFirstOrThrow();
    expect(retried).toMatchObject({ state: 'queued', last_error: 'OCR 실패' });
    expect(await failJob(db, { ...again, attempts: 3 }, '또 실패')).toBe('failed');
  });

  it('동시 처리 수만큼 쪽을 함께 처리하고, 줄이면 바로 반영한다', async () => {
    await db.updateTable('jobs').set({ state: 'done' }).execute();
    const page = await db.selectFrom('pages').select('id').executeTakeFirstOrThrow();
    for (let i = 0; i < 6; i++) await db.insertInto('jobs').values({ kind: 'process-page', page_id: page.id }).execute();

    let running = 0;
    let peak = 0;
    const log = { error: () => {}, warn: () => {} } as unknown as Parameters<typeof startWorker>[0]['log'];
    const worker = startWorker({
      db,
      log,
      pollMs: 20,
      concurrency: 3,
      handle: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        running--;
      },
    });
    while ((await db.selectFrom('jobs').select('id').where('state', '!=', 'done').execute()).length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(peak).toBe(3);
    worker.setConcurrency(1);
    expect(worker.concurrency()).toBe(1);
    await worker.stop();
  });
});
