import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrainingDocumentPreview } from '../../shared/types.ts';
import { trainingHwpx, trainingImage, trainingPdf, trainingTableOcr } from '../fixtures-training-document.ts';
import { createHarness, multipart, type Harness } from './harness.ts';
import { narabaeumSamples } from '../fixtures-certificates.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });

function upload(file: Buffer, name: string) {
  const body = multipart([{ name: 'file', value: file, filename: name }]);
  return h.send('POST', '/api/trainings/import/parse', body.payload, body.headers);
}

describe('교육 문서 가져오기', () => {
  it('실제 HWPX 표에서 여러 교육을 읽고, 선택한 교육을 등록한다', async () => {
    const response = await upload(await trainingHwpx(), '교육계획.hwpx');
    expect(response.statusCode, response.body).toBe(200);
    const result = response.json() as TrainingDocumentPreview;
    expect(result.drafts).toMatchObject([
      { name: '예시 안전교육', reqType: 'hours', reqValue: 2, legalBasis: '기관 교육계획 제1항', fromYear: 2026 },
      { name: '예시 정보보호교육', reqType: 'hours', reqValue: 0.5, toYear: 2027 },
    ]);
    const apply = await h.send('POST', '/api/trainings/import/apply', { fileName: result.fileName, trainings: result.drafts });
    expect(apply.statusCode, apply.body).toBe(200);
    expect(apply.json().created).toBe(2);
    const again = (await upload(await trainingHwpx(), '교육계획.hwpx')).json() as TrainingDocumentPreview;
    expect(again.drafts.every(d => d.duplicateId)).toBe(true);
  }, 30_000);

  it('실제 한글 텍스트 PDF의 교육명·기준을 읽는다', async () => {
    const response = await upload(await trainingPdf(), '교육안내.pdf');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().drafts).toMatchObject([
      { name: '예시 안전교육', reqType: 'hours', reqValue: 2 },
      { name: '예시 정보보호교육', reqType: 'count', reqValue: 1 },
    ]);
  }, 30_000);

  it('중복 교육이 섞이면 일부만 등록하지 않고 전체를 되돌린다', async () => {
    const count = (await h.send('GET', '/api/trainings')).json().length;
    const response = await h.send('POST', '/api/trainings/import/apply', { fileName: '계획.hwpx', trainings: [
      { name: '아직 없는 교육', reqType: 'count', reqValue: 1 },
      { name: '예시 안전교육', reqType: 'hours', reqValue: 2 },
    ] });
    expect(response.statusCode).toBe(409);
    expect((await h.send('GET', '/api/trainings')).json()).toHaveLength(count);
  });

  it('필수 기준이 없거나 문서 형식이 잘못되면 안내한다', async () => {
    expect((await upload(Buffer.from('broken'), '계획.hwpx')).statusCode).toBe(400);
    expect((await upload(Buffer.from('broken'), '계획.pdf')).statusCode).toBe(400);
    expect((await upload(Buffer.from('text'), '계획.hwp')).statusCode).toBe(400);
    expect((await h.send('POST', '/api/trainings/import/apply', { fileName: '계획.hwpx', trainings: [{ name: '빈 기준', reqType: null, reqValue: null }] })).statusCode).toBe(400);
    const body = multipart([{ name: 'file', value: Buffer.from('x'), filename: '계획.pdf' }]);
    expect((await h.app.inject({ method: 'POST', url: '/api/trainings/import/parse', payload: body.payload, headers: { ...body.headers, 'x-requested-with': 'fetch' } })).statusCode).toBe(401);
  });

  it('JPG·JPEG·PNG 사진을 OCR로 읽고 선택한 교육을 등록한다', async () => {
    h.ocr.text = '과 정 명    사진 안전교육\n이수기준: 연 2시간\n근거 법령: 기관 교육계획 제1항\n교육명: 사진 정보보호교육\n이수기준: 연 1회';
    let result: TrainingDocumentPreview | undefined;
    for (const [name, format] of [['교육.jpg', 'jpeg'], ['교육.JPEG', 'jpeg'], ['교육.png', 'png']] as const) {
      const response = await upload(await trainingImage(format), name);
      expect(response.statusCode, response.body).toBe(200);
      result = response.json();
      expect(result?.drafts).toMatchObject([
        { name: '사진 안전교육', reqType: 'hours', reqValue: 2 },
        { name: '사진 정보보호교육', reqType: 'count', reqValue: 1 },
      ]);
      expect(result?.warnings.join(' ')).toContain('사진');
    }
    expect((await h.send('POST', '/api/trainings/import/apply', { fileName: result!.fileName, trainings: result!.drafts })).json().created).toBe(2);
  });

  it('읽지 못한 사진의 기준을 추측하지 않고 재촬영 안내를 보여 준다', async () => {
    h.ocr.text = '';
    const blank = (await upload(await trainingImage(), '흐린사진.jpeg')).json() as TrainingDocumentPreview;
    expect(blank.drafts).toEqual([]);
    expect(blank.warnings.join(' ')).toContain('다시 촬영');
    h.ocr.text = '교육명: 기준 없는 사진교육\n교육대상: 직원';
    const missing = (await upload(await trainingImage('png'), '사진.png')).json() as TrainingDocumentPreview;
    expect(missing.drafts[0]).toMatchObject({ name: '기준 없는 사진교육', reqType: null, reqValue: null });
  });

  it('손상되거나 확장자만 바꾼 사진과 지나치게 큰 사진은 거절한다', async () => {
    expect((await upload(Buffer.from('broken'), '손상.jpeg')).statusCode).toBe(400);
    expect((await upload(Buffer.from('broken'), '손상.png')).statusCode).toBe(400);
    expect((await upload(await trainingImage('png'), '확장자만변경.jpg')).statusCode).toBe(400);
    expect((await upload(await trainingImage(), '확장자만변경.png')).statusCode).toBe(400);
    const oversized = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized);
    oversized.write('IHDR', 12); oversized.writeUInt32BE(10000, 16); oversized.writeUInt32BE(10000, 20);
    const response = await upload(oversized, '너무큰사진.png');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('화소');
  });

  it('사진 표의 글줄 위치를 사용해 교육 15개를 미리보고 선택 등록한다', async () => {
    const ocr = await trainingTableOcr();
    const table = await createHarness({}, { ocr: {
      name: 'table-fixture', label: '표 회귀 테스트', fallbackReason: null,
      recognize: async () => ocr.text, recognizeWithLayout: async () => ocr, close: async () => {},
    } });
    try {
      const body = multipart([{ name: 'file', value: await trainingImage(), filename: '교육현황.jpeg', type: 'image/jpeg' }]);
      const response = await table.send('POST', '/api/trainings/import/parse', body.payload, body.headers);
      expect(response.statusCode, response.body).toBe(200);
      const preview = response.json() as TrainingDocumentPreview;
      expect(preview.drafts).toHaveLength(15);
      expect(preview.warnings.join(' ')).toContain('작거나 흐린');
      expect(preview.drafts[1]).toMatchObject({ reqType: 'hours', reqValue: 5, keywords: ['성인지', '4대 폭력'] });
      const selected = [preview.drafts[0], preview.drafts[1], preview.drafts[2], preview.drafts[14]];
      const apply = await table.send('POST', '/api/trainings/import/apply', { fileName: preview.fileName, trainings: selected });
      expect(apply.statusCode, apply.body).toBe(200);
      expect(apply.json().created).toBe(4);
    } finally { await table.close(); }
  });

  it('교육 추가에 수료증을 넣어도 개인 수료시간을 연간 의무 기준으로 채우지 않는다', async () => {
    const body = multipart([
      { name: 'textLayer', value: narabaeumSamples[4].text },
      { name: 'file', value: await trainingPdf(), filename: '수료증.pdf', type: 'application/pdf' },
    ]);
    const response = await h.send('POST', '/api/trainings/import/parse', body.payload, body.headers);
    expect(response.statusCode, response.body).toBe(200);
    const draft = response.json().drafts[0];
    expect(draft).toMatchObject({ name: narabaeumSamples[4].expected.courseTitle, reqType: 'hours', reqValue: null, keywords: [] });
    expect(draft.note).toContain('1시간');
    expect(draft.warnings.join(' ')).toContain('연간 의무 기준');
    expect(draft.source).not.toContain('홍길동');
  });
});
