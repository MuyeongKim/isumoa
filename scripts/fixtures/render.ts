// 이수증 모양(Op 목록)을 텍스트 PDF 또는 "스캔한 것 같은" JPEG로 그린다. 개발용 도구.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { PAGE, type Op } from './certificate.ts';

const FONT_DIR = fileURLToPath(new URL('../../node_modules/pretendard/dist/public/static/alternative/', import.meta.url));
const REGULAR = readFileSync(`${FONT_DIR}Pretendard-Regular.ttf`);
const BOLD = readFileSync(`${FONT_DIR}Pretendard-Bold.ttf`);
GlobalFonts.register(REGULAR, 'FixtureRegular');
GlobalFonts.register(BOLD, 'FixtureBold');

const SEAL_RED = '#c8372d';

function hex(color = '#1a1a1a') {
  const n = Number.parseInt(color.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** 텍스트 PDF: 여러 쪽(각 쪽은 Op 목록)을 한 파일로 */
export async function renderTextPdf(pages: Op[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  // 글꼴을 통째로 넣는다: fontkit의 부분 글꼴(subset)은 한글 TrueType의 조합 글리프를 빠뜨려
  // pdf.js에서 글자가 비어 보인다. 파일 크기를 줄이려고 굵은 글꼴도 보통 글꼴로 대신한다.
  const korean = await doc.embedFont(REGULAR, { subset: false });
  // 영문·숫자·문장부호는 PDF 표준 글꼴로 쓴다. 한글 글꼴을 통째로 넣으면 ':' 같은 글자의
  // 글자 정보(ToUnicode)가 엉뚱한 문자로 들어가는 문제를 피하려는 것 (실제 PDF도 글꼴을 섞어 쓴다)
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  for (const ops of pages) drawPdfPage(doc.addPage([PAGE.width, PAGE.height]), ops, { korean, latin });
  return doc.save();
}

interface PdfFonts {
  korean: PDFFont;
  latin: PDFFont;
}

/** 글자를 영문(표준 글꼴)과 그 밖(한글 글꼴) 구간으로 나눈다 */
function runs(text: string, fonts: PdfFonts): { text: string; font: PDFFont }[] {
  return (text.match(/[\x20-\x7e]+|[^\x20-\x7e]+/g) ?? []).map((part) => ({
    text: part,
    font: /^[\x20-\x7e]+$/.test(part) ? fonts.latin : fonts.korean,
  }));
}

function textWidth(text: string, size: number, fonts: PdfFonts): number {
  return runs(text, fonts).reduce((sum, r) => sum + r.font.widthOfTextAtSize(r.text, size), 0);
}

function drawText(page: PDFPage, text: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>, fonts: PdfFonts) {
  for (const r of runs(text, fonts)) {
    page.drawText(r.text, { x, y, size, font: r.font, color });
    x += r.font.widthOfTextAtSize(r.text, size);
  }
}

function drawPdfPage(page: PDFPage, ops: Op[], fonts: PdfFonts) {
  const flip = (y: number) => PAGE.height - y;
  for (const op of ops) {
    if (op.kind === 'text') {
      const width = textWidth(op.text, op.size, fonts);
      const x = op.align === 'center' ? op.x - width / 2 : op.x;
      drawText(page, op.text, x, flip(op.y), op.size, hex(op.color), fonts);
    } else if (op.kind === 'rect') {
      page.drawRectangle({
        x: op.x,
        y: flip(op.y + op.h),
        width: op.w,
        height: op.h,
        borderWidth: op.lineWidth,
        borderColor: hex(op.color),
        ...(op.fill ? { color: hex(op.fill) } : {}),
      });
    } else if (op.kind === 'line') {
      page.drawLine({ start: { x: op.x1, y: flip(op.y1) }, end: { x: op.x2, y: flip(op.y2) }, thickness: op.lineWidth, color: hex(op.color) });
    } else {
      page.drawRectangle({ x: op.x, y: flip(op.y + op.size), width: op.size, height: op.size, borderWidth: 2.4, borderColor: hex(SEAL_RED) });
      const size = op.size * 0.32;
      drawText(page, '직인', op.x + (op.size - textWidth('직인', size, fonts)) / 2, flip(op.y + op.size * 0.62), size, hex(SEAL_RED), fonts);
    }
  }
}

export interface ScanOptions {
  dpi?: number;
  /** 기울기(도) */
  angle?: number;
  /** 0~1, 점 잡음의 양 */
  noise?: number;
  seed?: number;
}

/** 종이를 스캐너로 읽은 것처럼: 약간 누런 바탕, 기울기, 점 잡음, JPEG 압축 */
export async function renderScanJpeg(ops: Op[], options: ScanOptions = {}): Promise<Buffer> {
  const { dpi = 200, angle = 0, noise = 0.4, seed = 1 } = options;
  const scale = dpi / 72;
  const width = Math.round(PAGE.width * scale);
  const height = Math.round(PAGE.height * scale);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f6f4ee';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((angle * Math.PI) / 180);
  ctx.translate(-width / 2, -height / 2);
  ctx.scale(scale, scale);
  for (const op of ops) {
    ctx.strokeStyle = op.kind !== 'seal' ? (('color' in op && op.color) || '#222') : SEAL_RED;
    if (op.kind === 'text') {
      ctx.fillStyle = op.color ?? '#202020';
      ctx.font = `${op.size}px ${op.bold ? 'FixtureBold' : 'FixtureRegular'}`;
      ctx.textAlign = op.align === 'center' ? 'center' : 'left';
      ctx.fillText(op.text, op.x, op.y);
    } else if (op.kind === 'rect') {
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.w, op.h);
      }
      ctx.lineWidth = op.lineWidth;
      ctx.strokeRect(op.x, op.y, op.w, op.h);
    } else if (op.kind === 'line') {
      ctx.lineWidth = op.lineWidth;
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2.4;
      ctx.strokeRect(op.x, op.y, op.size, op.size);
      ctx.fillStyle = SEAL_RED;
      ctx.font = `${op.size * 0.32}px FixtureBold`;
      ctx.textAlign = 'center';
      ctx.fillText('직인', op.x + op.size / 2, op.y + op.size * 0.62);
    }
  }
  ctx.restore();

  // 스캐너 먼지 같은 점
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  ctx.fillStyle = 'rgba(40, 40, 40, 0.55)';
  for (let i = 0; i < width * height * 0.0004 * noise; i++) {
    ctx.fillRect(random() * width, random() * height, 1 + random() * 2, 1 + random() * 2);
  }
  return canvas.encode('jpeg', 72);
}

/** JPEG 여러 장을 한 PDF로 (글자 정보가 없는 스캔본) */
export async function jpegsToPdf(jpegs: Buffer[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  doc.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  for (const jpeg of jpegs) {
    const image = await doc.embedJpg(jpeg);
    doc.addPage([PAGE.width, PAGE.height]).drawImage(image, { x: 0, y: 0, width: PAGE.width, height: PAGE.height });
  }
  return doc.save();
}
