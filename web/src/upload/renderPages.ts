import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { withBase } from '../lib/base.ts';
import { joinPdfTextItems, type PdfTextItem } from '../../../shared/pdfText.ts';

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
    cMapUrl: withBase('/pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: withBase('/pdfjs/standard_fonts/'),
    wasmUrl: withBase('/pdfjs/wasm/'),
  });
  try {
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (error) {
    await task.destroy().catch(() => {});
    const name = error instanceof Error ? error.name : '';
    if (name === 'PasswordException') throw new Error('암호로 잠긴 PDF입니다. 암호를 해제한 사본을 선택해 주세요.');
    if (name === 'InvalidPDFException') throw new Error('PDF가 손상되었거나 올바른 PDF 형식이 아닙니다. 원본을 다시 내려받거나 PDF로 다시 저장한 뒤 올려 주세요.');
    throw new Error('PDF를 열지 못했습니다. 파일이 정상적으로 열리는지 확인한 뒤 다시 선택해 주세요.');
  }
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

/** 교육 문서 가져오기도 이수증 올리기와 같은 PDF 글자 읽기 순서를 쓴다. */
export async function extractPdfText(file: File): Promise<string> {
  const { doc, close } = await openPdf(file);
  try {
    if (doc.numPages > 100) throw new Error('교육 문서는 100쪽 이하로 나누어 올려 주세요.');
    const pages: string[] = [];
    let length = 0;
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await doc.getPage(index);
      const content = await page.getTextContent();
      const text = joinPdfTextItems(content.items.filter((i): i is PdfTextItem & typeof i => 'str' in i));
      length += text.length;
      if (length > 300_000) throw new Error('내용이 너무 많습니다. 교육 목록 부분만 나누어 올려 주세요.');
      pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n');
  } finally { await close(); }
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
  const items = content.items.filter((i): i is PdfTextItem & typeof i => 'str' in i);
  const result: RenderedPage = {
    width: canvas.width,
    height: canvas.height,
    text: joinPdfTextItems(items),
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
