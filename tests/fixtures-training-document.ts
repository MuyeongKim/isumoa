import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { OcrReadResult } from '../server/src/ocr/engine.ts';

export async function trainingTableOcr(): Promise<OcrReadResult> {
  return JSON.parse(await readFile(new URL('./fixtures/training-table-ocr.json', import.meta.url), 'utf8')) as OcrReadResult;
}

export const TRAINING_MARKDOWN = `# 2026년 예시 교육 계획

| 교육명 | 교육시간 | 근거 법령 | 분류 | 적용연도 |
| --- | --- | --- | --- | --- |
| 예시 안전교육 | 연 2시간 | 기관 교육계획 제1항 | 안전 | 2026 |
| 예시 정보보호교육 | 30분 | 기관 교육계획 제2항 | 정보보호 | 2026~2027 |
`;

export async function trainingHwpx() {
  process.env.KORDOC_OFFLINE = '1';
  const { markdownToHwpx } = await import('kordoc');
  return Buffer.from(await markdownToHwpx(TRAINING_MARKDOWN));
}

export async function trainingPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const korean = await doc.embedFont(await readFile(new URL('../node_modules/wanted-sans/fonts/ttf/WantedSans-Regular.ttf', import.meta.url)));
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const lines = ['2026년 예시 교육 계획', '교육명: 예시 안전교육', '이수기준: 연 2시간', '근거 법령: 기관 교육계획 제1항', '교육명: 예시 정보보호교육', '이수기준: 연 1회', '적용연도: 2026'];
  for (const [i, line] of lines.entries()) {
    let x = 48;
    for (const part of line.match(/[\x20-\x7e]+|[^\x20-\x7e]+/g) ?? []) {
      const font = /^[\x20-\x7e]+$/.test(part) ? latin : korean;
      page.drawText(part, { x, y: 780 - i * 32, size: 14, font });
      x += font.widthOfTextAtSize(part, 14);
    }
  }
  return Buffer.from(await doc.save());
}

export async function trainingImage(format: 'jpeg' | 'png' = 'jpeg') {
  GlobalFonts.registerFromPath(fileURLToPath(new URL('../node_modules/wanted-sans/fonts/ttf/WantedSans-Regular.ttf', import.meta.url)), 'TrainingPhotoFixture');
  const canvas = createCanvas(1200, 1500);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111'; context.font = '32px TrainingPhotoFixture';
  ['2026년 교육 안내', '교육명: 사진 안전교육', '이수기준: 연 2시간', '근거 법령: 기관 교육계획 제1항', '교육명: 사진 정보보호교육', '이수기준: 연 1회']
    .forEach((line, index) => context.fillText(line, 80, 130 + index * 90));
  return format === 'png' ? canvas.encode('png') : canvas.encode('jpeg', 90);
}
