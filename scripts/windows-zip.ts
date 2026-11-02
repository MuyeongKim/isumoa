import { readFileSync } from 'node:fs';
import { Uint8ArrayReader, ZipReader } from '@zip.js/zip.js/index-native.js';

/** 압축 원본이 정상이더라도 실제 ZIP에 링크가 들어갔으면 Windows 설치판을 내보내지 않는다. */
export async function assertNoZipSymlinks(path: string): Promise<number> {
  const reader = new ZipReader(new Uint8ArrayReader(readFileSync(path)), { useWebWorkers: false });
  const links: string[] = [];
  let entries = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      entries++;
      if (entry.symlink || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) links.push(entry.filename);
    }
  } finally { await reader.close(); }
  if (links.length) throw new Error(`Windows 배포 ZIP에 심볼릭 링크가 남아 있습니다:\n${links.join('\n')}`);
  return entries;
}
