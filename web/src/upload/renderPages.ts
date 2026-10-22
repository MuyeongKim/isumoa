import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// 서무 PC의 브라우저에서 PDF를 쪽마다 이미지로 그리고 글자층을 뽑는다.
// 서버에서 하지 않는 이유: OS별로 컴파일해야 하는 그림 라이브러리 없이 설치본을 유지하려고.

GlobalWorkerOptions.workerSrc = workerUrl;

/** OCR·증빙용 큰 이미지 가로 크기 (A4 약 240dpi) */
const IMAGE_WIDTH = 2000;
const THUMB_WIDTH = 300;

export interface RenderedPage {
  width: number;
  height: number;
  /** PDF에 들어 있는 글자. 스캔본이면 비어 있다 */
  text: string;
  image: Blob;
  thumb: Blob;
}

/** PDF 열기. 다 쓰면 close()로 메모리를 돌려준다 */
export async function openPdf(file: File): Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = getDocument({
    data,
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  });
  return { doc: await task.promise, close: () => task.destroy() };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('이미지를 만들지 못했습니다.'))), 'image/jpeg', quality),
  );
}

/** 큰 그림을 작게 줄인 목록용 이미지 */
async function thumbnailOf(source: HTMLCanvasElement): Promise<Blob> {
  const thumb = document.createElement('canvas');
  thumb.width = THUMB_WIDTH;
  thumb.height = Math.round((source.height / source.width) * THUMB_WIDTH);
  const ctx = thumb.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  return toBlob(thumb, 0.8);
}

interface TextItemLike {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
  height: number;
}

/**
 * 글자 조각을 줄 단위로 이어 붙인다. 같은 줄에서 간격이 넓으면 빈칸 두 개를 넣어
 * "성명 홍길동    생년월일 1985-03-12"처럼 항목이 나뉜 것을 남긴다.
 */
function joinTextItems(items: TextItemLike[]): string {
  let text = '';
  let prev: TextItemLike | null = null;
  for (const item of items) {
    if (prev) {
      const sameLine = Math.abs(item.transform[5] - prev.transform[5]) < Math.max(prev.height, 1) * 0.5;
      if (prev.hasEOL || !sameLine) {
        text += '\n';
      } else {
        const gap = item.transform[4] - (prev.transform[4] + prev.width);
        const size = Math.max(prev.height, 1);
        if (gap > size * 0.8) text += '  ';
        else if (gap > size * 0.15 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
      }
    }
    text += item.str;
    prev = item;
  }
  return text.normalize('NFC');
}

export async function renderPdfPage(doc: PDFDocumentProxy, pageNo: number): Promise<RenderedPage> {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(IMAGE_WIDTH / base.width, 4) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport, background: 'rgb(255,255,255)' }).promise;

  const content = await page.getTextContent();
  const items = content.items.filter((i): i is TextItemLike & typeof i => 'str' in i);
  const result: RenderedPage = {
    width: canvas.width,
    height: canvas.height,
    text: joinTextItems(items),
    image: await toBlob(canvas, 0.85),
    thumb: await thumbnailOf(canvas),
  };
  page.cleanup();
  return result;
}

/** 사진·스캔 이미지(JPG·PNG): 휴대폰 사진의 회전 정보를 반영해 같은 크기로 맞춘다 */
export async function renderImageFile(file: File): Promise<RenderedPage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(IMAGE_WIDTH / bitmap.width, 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { width: canvas.width, height: canvas.height, text: '', image: await toBlob(canvas, 0.88), thumb: await thumbnailOf(canvas) };
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImage(file: File): boolean {
  return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name);
}
