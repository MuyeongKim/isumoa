import type { FileUploadResult } from '@shared/types.ts';
import { api } from '@/lib/api';
import { isImage, isPdf, openPdf, renderImageFile, renderPdfPage, type RenderedPage } from './renderPages';

// 파일 하나 올리기: 원본 → 서버가 이미 받은 쪽은 건너뛰고 나머지 쪽을 하나씩 그려서 올린다.
// 중간에 끊겨도 같은 파일을 같은 묶음에 다시 올리면 빠진 쪽부터 이어서 올린다.

export type UploadOutcome =
  | { kind: 'done'; pages: number; skipped: number }
  | { kind: 'duplicate'; fileName: string; batchId: number; createdAt: string };

export async function uploadFile(
  batchId: number,
  file: File,
  onProgress: (done: number, total: number) => void,
  options: { force?: boolean } = {},
): Promise<UploadOutcome> {
  if (!isPdf(file) && !isImage(file)) throw new Error('PDF, JPG, PNG 파일만 올릴 수 있습니다.');

  const pdf = isPdf(file) ? await openPdf(file) : null;
  const doc = pdf?.doc ?? null;
  try {
    const pageCount = doc ? doc.numPages : 1;
    const form = new FormData();
    form.append('pageCount', String(pageCount));
    if (options.force) form.append('force', '1');
    form.append('file', file);
    const result = await api.post<FileUploadResult>(`/batches/${batchId}/files`, form);
    if (result.duplicateOf) {
      return { kind: 'duplicate', fileName: result.duplicateOf.fileName, batchId: result.duplicateOf.batchId, createdAt: result.duplicateOf.createdAt };
    }

    const already = new Set(result.uploadedPages);
    let done = already.size;
    onProgress(done, pageCount);
    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      if (already.has(pageNo)) continue;
      const page: RenderedPage = doc ? await renderPdfPage(doc, pageNo) : await renderImageFile(file);
      const pageForm = new FormData();
      pageForm.append('pageNo', String(pageNo));
      pageForm.append('width', String(page.width));
      pageForm.append('height', String(page.height));
      pageForm.append('text', page.text);
      pageForm.append('image', page.image, `${pageNo}.jpg`);
      pageForm.append('thumb', page.thumb, `${pageNo}_thumb.jpg`);
      await api.post(`/files/${result.fileId}/pages`, pageForm);
      onProgress(++done, pageCount);
    }
    return { kind: 'done', pages: pageCount, skipped: already.size };
  } finally {
    await pdf?.close();
  }
}
