import { join } from 'node:path';

// 올린 파일을 두는 곳 (모두 데이터 폴더 안):
//   files/<uuid>.pdf          원본 파일
//   pages/<파일 id>/<쪽>.jpg   쪽 이미지 (OCR·검수 화면·증빙용)
//   pages/<파일 id>/<쪽>_thumb.jpg  목록용 작은 이미지
// 디스크의 파일 이름에는 사람 이름 같은 개인정보를 쓰지 않는다.

export function filesDir(dataDir: string): string {
  return join(dataDir, 'files');
}

export function originalPath(dataDir: string, storedName: string): string {
  return join(filesDir(dataDir), storedName);
}

export function pagesDir(dataDir: string, fileId: number): string {
  return join(dataDir, 'pages', String(fileId));
}

export function pageImagePath(dataDir: string, fileId: number, pageNo: number, kind: 'image' | 'thumb'): string {
  return join(pagesDir(dataDir, fileId), kind === 'image' ? `${pageNo}.jpg` : `${pageNo}_thumb.jpg`);
}

/** 파일 앞부분으로 형식을 확인한다 (확장자는 믿지 않는다) */
export function detectUploadType(head: Buffer): { mime: string; ext: string } | null {
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: 'pdf' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG') return { mime: 'image/png', ext: 'png' };
  return null;
}
