import { createWriteStream, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZipArchive } from 'archiver';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { assertNoZipSymlinks } from '../../scripts/windows-zip.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'isumoa-release-zip-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
async function archive() {
  const destination = join(root, 'release.zip');
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destination); const zip = new ZipArchive();
    output.on('close', resolve); output.on('error', reject); zip.on('error', reject);
    zip.pipe(output); zip.directory(join(root, 'program'), 'program'); void zip.finalize();
  });
  return destination;
}
function files() {
  mkdirSync(join(root, 'program/하위 폴더'), { recursive: true });
  writeFileSync(join(root, 'program/PC설치안내.txt'), '\uFEFF안내\r\n');
  writeFileSync(join(root, 'program/하위 폴더/.hidden'), '보존할 파일');
}
it('실제 압축 결과의 한글·숨김 파일과 일반 디렉터리는 허용한다', async () => {
  files(); expect(await assertNoZipSymlinks(await archive())).toBe(3);
});
it.each(['file', 'directory'])('실제 archiver ZIP의 %s 심볼릭 링크 항목을 거부한다', async kind => {
  files(); symlinkSync(kind === 'file' ? 'PC설치안내.txt' : '하위 폴더', join(root, 'program/남은 링크'));
  await expect(assertNoZipSymlinks(await archive())).rejects.toThrow('program/남은 링크');
});
it('읽을 수 없거나 손상된 ZIP을 성공으로 처리하지 않는다', async () => {
  await expect(assertNoZipSymlinks(join(root, 'missing.zip'))).rejects.toThrow();
  const corrupt = join(root, 'corrupt.zip'); writeFileSync(corrupt, 'ZIP 아님');
  await expect(assertNoZipSymlinks(corrupt)).rejects.toThrow();
});
