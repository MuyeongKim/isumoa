import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { AiHealth } from '../../server/src/ai/health.ts';
import { buildApp } from '../../server/src/app.ts';
import { processPage } from '../../server/src/certs/processPage.ts';
import { loadConfig, type AppConfig } from '../../server/src/config.ts';
import { runMigrations } from '../../server/src/db/migrate.ts';
import type { DB } from '../../server/src/db/schema.ts';
import { seedDefaults } from '../../server/src/db/seed.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';
import { claimNextJob, failJob, finishJob, MAX_ATTEMPTS } from '../../server/src/jobs/queue.ts';

// API 테스트 공통: 메모리 DB로 앱을 띄우고, 관리자로 로그인하고, 이수증 쪽을 올려 처리하는 도우미.
// OCR은 ocr.text에 넣어 둔 글자를 돌려주는 가짜를 쓴다 (실제 OCR은 시연에서 확인).

export const PDF = Buffer.from('%PDF-1.4\n% test\n');
const JPEG = createCanvas(40, 56).encode('jpeg') as unknown as Promise<Buffer>;

export interface Harness {
  app: FastifyInstance;
  db: Kysely<DB>;
  dataDir: string;
  config: AppConfig;
  aiHealth: AiHealth;
  /** 가짜 OCR이 돌려줄 글자 */
  ocr: { text: string };
  send(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, extra?: Record<string, string>): Promise<LightMyRequestResponse>;
  uploadFile(batchId: number, file: Buffer, name: string, pageCount?: number): Promise<LightMyRequestResponse>;
  uploadPage(fileId: number, pageNo: number, text: string): Promise<number>;
  /** 대기열에 쌓인 쪽을 모두 처리한다 (실제 서버에서는 일꾼이 한다). 실패하면 일꾼처럼 다시 시도로 돌린다 */
  drainQueue(): Promise<string[]>;
  close(): Promise<void>;
}

function multipart(parts: { name: string; value: string | Buffer; filename?: string; type?: string }[]) {
  const boundary = '----test' + Math.random().toString(16).slice(2);
  const chunks: Buffer[] = [];
  for (const p of parts) {
    const disposition = `form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ''}`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ''}\r\n`));
    chunks.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value));
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function createHarness(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'ecp-test-'));
  const opened = openDatabase(':memory:');
  const db = opened.db;
  runMigrations(opened.raw);
  await seedDefaults(db);
  const config: AppConfig = { ...loadConfig({}), dataDir, webDistDir: '/nonexistent', ...overrides };
  const aiHealth = new AiHealth();
  const app = await buildApp({ db, config, version: 'test', aiHealth }, { logger: false });
  const ocr = { text: '', recognize: async () => ocr.text, close: async () => {} };
  let cookie = '';

  const send: Harness['send'] = (method, url, payload, extra = {}) =>
    app.inject({ method, url, payload: payload as object, headers: { 'x-requested-with': 'fetch', cookie, ...extra } });

  const setup = await send('POST', '/api/setup', { orgName: '가람시', loginId: 'admin', name: '관리자', password: 'Garam1234!' });
  cookie = `ecp_sid=${setup.cookies.find((c) => c.name === 'ecp_sid')!.value}`;

  return {
    app,
    db,
    dataDir,
    config,
    aiHealth,
    ocr,
    send,
    uploadFile(batchId, file, name, pageCount = 1) {
      const body = multipart([
        { name: 'pageCount', value: String(pageCount) },
        { name: 'file', value: file, filename: name, type: 'application/pdf' },
      ]);
      return send('POST', `/api/batches/${batchId}/files`, body.payload, body.headers);
    },
    async uploadPage(fileId, pageNo, text) {
      const jpeg = await JPEG;
      const body = multipart([
        { name: 'pageNo', value: String(pageNo) },
        { name: 'width', value: '40' },
        { name: 'height', value: '56' },
        { name: 'text', value: text },
        { name: 'image', value: jpeg, filename: 'p.jpg', type: 'image/jpeg' },
        { name: 'thumb', value: jpeg, filename: 't.jpg', type: 'image/jpeg' },
      ]);
      const res = await send('POST', `/api/files/${fileId}/pages`, body.payload, body.headers);
      expect(res.statusCode).toBe(200);
      return res.json().pageId;
    },
    async drainQueue() {
      const errors: string[] = [];
      for (let job = await claimNextJob(db); job; job = await claimNextJob(db)) {
        try {
          await processPage({ db, dataDir, ocr, config, aiHealth }, job.page_id, { finalAttempt: job.attempts >= MAX_ATTEMPTS });
          await finishJob(db, job.id);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
          await failJob(db, job, errors.at(-1)!);
        }
      }
      return errors;
    },
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
