import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import { recognizePage } from '../../server/src/certs/recognize.ts';
import { runMigrations } from '../../server/src/db/migrate.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';
import { createOcrEngine, type OcrEngine } from '../../server/src/ocr/engine.ts';
import { markdownToText, rowsText } from '../../server/src/ocr/kordoc.ts';

const MODELS = fileURLToPath(new URL('../../vendor/ocr-models/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ecp-ocr-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('kordoc 결과를 판독기가 읽는 글로', () => {
  const line = (text: string, x: number, y: number, h = 40) => ({ text, confidence: 0.9, box: { x, y, w: 100, h } });

  it('따로 읽힌 항목 이름과 값을 높이로 묶어 한 줄로', () => {
    const text = rowsText([line(':강아지', 600, 302), line('성 명', 150, 300), line(': 1979.1.11.', 600, 382, 42), line('생년월일', 150, 380)]);
    expect(text).toBe('성 명    :강아지\n생년월일    : 1979.1.11.');
    expect(parseCertificateText(text)).toMatchObject({ personName: '강아지', personBirth: '1979-01-11' });
  });

  it('Markdown 표는 칸을 넓은 빈칸으로, 이스케이프는 풀어서', () => {
    expect(markdownToText('| 이름 | 송주주 |\n| --- | --- |\n| 학습기간 | 2026-04-01\\~2026-04-13 |')).toBe('이름    송주주\n학습기간    2026-04-01~2026-04-13');
  });

  it('항목 이름에 붙어 읽힌 값도 찾는다', () => {
    expect(parseCertificateText('성명송주주\n생년월일1974-08-25\n교육일: 2026.05.04 (2시간)')).toMatchObject({
      personName: '송주주',
      personBirth: '1974-08-25',
      completedOn: '2026-05-04',
    });
    expect(parseCertificateText('성명서를 제출합니다').personName).toBeNull();
  });
});

describe('OCR 엔진 고르기', () => {
  let engine: OcrEngine | null = null;
  afterAll(async () => engine?.close());

  it('kordoc(PP-OCRv5)을 띄우고 자체 점검 이미지를 읽는다', async () => {
    engine = await createOcrEngine({ modelDir: MODELS });
    expect(engine).toMatchObject({ name: 'kordoc-ppocrv5', fallbackReason: null });
    expect((await engine.recognize(join(MODELS, 'selftest.jpg'))).replace(/\s/g, '')).toContain('윤하늘');
  }, 60_000);

  it('모델이 없으면 tesseract로 바꾸고 이유를 남긴다', async () => {
    const fallback = await createOcrEngine({ modelDir: temp });
    expect(fallback.name).toBe('tesseract');
    expect(fallback.fallbackReason).toBeTruthy();
    await fallback.close();
  });
});

describe('엔진이 바뀌면 다시 읽기', () => {
  it('다른 엔진으로 읽어 둔 글자는 새 엔진으로 다시 읽고, 같은 엔진이면 그대로 쓴다', async () => {
    const { raw, db } = openDatabase(':memory:');
    runMigrations(raw);
    const calls: string[] = [];
    const fake = (name: string): OcrEngine => ({ name, label: name, fallbackReason: null, recognize: async (p) => (calls.push(p), `성 명 : 송주주 (${name})`), close: async () => {} });
    const page = { id: 1, file_id: 1, page_no: 1, text_layer: null, ocr_text: '성 명 : 소즈즈', ocr_engine: 'tesseract' };
    await db.insertInto('departments').values({ name: '총무과' }).execute();

    const first = await recognizePage({ db, dataDir: temp, ocr: fake('kordoc-ppocrv5') }, page);
    expect(first.read.personName).toBe('송주주');
    expect(calls).toHaveLength(1);
    const again = await recognizePage({ db, dataDir: temp, ocr: fake('kordoc-ppocrv5') }, { ...page, ocr_text: first.text, ocr_engine: 'kordoc-ppocrv5' });
    expect(again.text).toBe(first.text);
    expect(calls).toHaveLength(1);
    await db.destroy();
  });
});

describe('마이그레이션 005', () => {
  it('새 DB에는 AI 열·설정이 없고 OCR 엔진 열이 있다', async () => {
    const { raw, db } = openDatabase(':memory:');
    // 004까지 적용한 옛 DB를 흉내 낸다
    const all = runMigrations(raw);
    expect(all).toContain('005_ocr_only.sql');
    const columns = raw.prepare('PRAGMA table_info(pages)').all().map((c) => String(c.name));
    expect(columns).toContain('ocr_engine');
    expect(columns.some((c) => c.startsWith('ai_'))).toBe(false);
    expect(await db.selectFrom('settings').select('key').where('key', '=', 'ai').executeTakeFirst()).toBeUndefined();
    await db.destroy();
  });
});
