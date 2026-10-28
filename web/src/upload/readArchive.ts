import { BlobReader, ZipReader, type FileEntry } from '@zip.js/zip.js/index-native.js';

export const ZIP_LIMITS = { archiveBytes: 300 * 1024 ** 2, fileBytes: 100 * 1024 ** 2, totalBytes: 500 * 1024 ** 2, files: 1000, entries: 5000 };
export interface ArchiveFile { file: File; path: string }
export interface ArchiveResult { name: string; files: ArchiveFile[]; skipped: { path: string; reason: string }[] }
export const isZip = (file: File) => /\.zip$/i.test(file.name);
export const isCertificateName = (name: string) => /\.(pdf|jpe?g|png)$/i.test(name);
class ArchiveLimitError extends Error {}

function safePath(name: string): boolean {
  return name.length <= 1024 && !/^[\\/]|[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069:]/.test(name) && !name.replace(/\\/g, '/').split('/').some(p => p === '..' || p === '.' || p === '');
}
function decodeName(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('euc-kr').decode(bytes); }
}
function mimeOf(name: string): string { return /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'; }
async function validHeader(file: File): Promise<boolean> {
  const b = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return file.type === 'application/pdf' ? String.fromCharCode(...b.slice(0, 4)) === '%PDF'
    : file.type === 'image/jpeg' ? b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
    : [137,80,78,71,13,10,26,10].every((n,i) => b[i] === n);
}

/** 브라우저 안에서만 푼다. 경로를 디스크에 쓰지 않고, 실제 출력 바이트도 제한한다. */
export async function readArchive(file: File, onProgress: (name: string, done: number, total: number) => void = () => {}, remaining?: { files: number; bytes: number }): Promise<ArchiveResult> {
  if (file.size > ZIP_LIMITS.archiveBytes) throw new Error('ZIP 파일은 300MB 이하로 나누어 올려 주세요.');
  const maxFiles = Math.min(ZIP_LIMITS.files, remaining?.files ?? ZIP_LIMITS.files);
  const maxBytes = Math.min(ZIP_LIMITS.totalBytes, remaining?.bytes ?? ZIP_LIMITS.totalBytes);
  const reader = new ZipReader(new BlobReader(file), { useWebWorkers: false, strictness: 'balanced', checkCrc32: true, checkOverlappingEntry: true, decodeText: (bytes, _encoding, type) => type === 'filename' ? decodeName(bytes) : undefined });
  const result: ArchiveResult = { name: file.name, files: [], skipped: [] };
  const candidates: { entry: FileEntry; path: string }[] = [];
  let entries = 0, expectedBytes = 0, totalBytes = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      if (++entries > ZIP_LIMITS.entries) throw new ArchiveLimitError('ZIP 안의 항목이 너무 많습니다. 여러 ZIP으로 나누어 올려 주세요.');
      if (entry.directory) continue;
      const path = entry.filename.normalize('NFC').replace(/\\/g, '/');
      if (safePath(path) && (path.split('/').some(p => p.startsWith('.')) || path.startsWith('__MACOSX/'))) continue;
      let reason = !safePath(path) || entry.symlink ? '안전하지 않은 경로 또는 바로가기 파일' : !isCertificateName(path) ? 'PDF·JPG·JPEG·PNG가 아닌 파일 (중첩 압축 포함)' : entry.encrypted ? '암호가 걸린 파일 — 압축을 해제한 뒤 다시 올려 주세요.' : ![0,8].includes(entry.compressionMethod) ? '지원하지 않는 ZIP 압축 방식' : null;
      const name = path.split('/').at(-1)!;
      if (name.length > 255) reason = '파일 이름이 너무 깁니다.';
      if (reason) { result.skipped.push({ path, reason }); continue; }
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > ZIP_LIMITS.fileBytes) throw new ArchiveLimitError('ZIP 안의 개별 파일은 100MB 이하로 나누어 주세요.');
      expectedBytes += entry.uncompressedSize;
      if (expectedBytes > maxBytes) throw new ArchiveLimitError('압축을 푼 수료증이 500MB를 넘습니다. 여러 ZIP으로 나누어 주세요.');
      if (candidates.length >= maxFiles) throw new ArchiveLimitError('ZIP 하나에는 수료증을 1,000개 이하로 담아 주세요.');
      candidates.push({ entry, path });
    }
    for (const [index, { entry, path }] of candidates.entries()) {
      onProgress(path, index, candidates.length);
      let bytes = 0;
      const parts: Uint8Array<ArrayBuffer>[] = [];
      try {
        await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
          bytes += chunk.byteLength; totalBytes += chunk.byteLength;
          if (bytes > ZIP_LIMITS.fileBytes || totalBytes > maxBytes) throw new ArchiveLimitError('실제 압축 해제 용량이 제한을 넘었습니다. 여러 ZIP으로 나누어 주세요.');
          parts.push(new Uint8Array(chunk));
        } }), { useWebWorkers: false, checkCrc32: true });
        if (bytes !== entry.uncompressedSize) throw new Error('size mismatch');
        const extracted = new File(parts, path.split('/').at(-1)!, { type: mimeOf(path) });
        if (!(await validHeader(extracted))) { result.skipped.push({ path, reason: '확장자와 실제 파일 형식이 다릅니다.' }); continue; }
        result.files.push({ file: extracted, path });
      } catch (error) {
        if (error instanceof ArchiveLimitError || bytes > ZIP_LIMITS.fileBytes || totalBytes > maxBytes) throw new ArchiveLimitError('실제 압축 해제 용량이 제한을 넘었습니다. 여러 ZIP으로 나누어 주세요.');
        result.skipped.push({ path, reason: '파일이 손상되었거나 압축 내용을 확인할 수 없습니다.' });
      }
      onProgress(path, index + 1, candidates.length);
    }
    return result;
  } catch (error) {
    if (error instanceof ArchiveLimitError) throw error;
    if (error instanceof Error && error.message === 'Unsafe filename') throw new Error('안전하지 않은 경로가 들어 있는 ZIP입니다. 이 압축파일은 등록하지 않았습니다.');
    throw new Error('ZIP 파일을 읽지 못했습니다. 손상·분할 압축 여부를 확인하거나 압축을 직접 풀어 올려 주세요.');
  } finally { await reader.close(); }
}
