import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { checkDocLinks, markdownFiles, markdownLinks } from '../../scripts/check-doc-links.ts';

let temporary: string, root: string;
beforeEach(() => { temporary = mkdtempSync(join(tmpdir(), 'isumoa-docs-')); root = join(temporary, 'repo'); mkdirSync(root); });
afterEach(() => rmSync(temporary, { recursive: true, force: true }));
function put(path: string, body = '') { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); }

it('문서별 상대 경로로 일반·참조 링크와 이미지·폴더를 검사한다', () => {
  put('docs/사용자/안내.md', '[처음](../../README.md#제목)'); put('docs/images/화면.png');
  put('README.md', '[안내](docs/사용자/안내.md#설치)\n[다시][guide]\n![화면](docs/images/화면.png)\n![참조][picture]\n[폴더](docs/사용자/)\n\n[guide]: docs/사용자/안내.md?raw=1\n[picture]: docs/images/화면.png "화면"');
  expect(checkDocLinks(root, ['README.md', 'docs/사용자/안내.md'])).toEqual({ files: 2, checked: 6, errors: [] });
});
it('HTML 이미지와 링크의 속성·엔티티도 검사하고 주석 예제는 제외한다', () => {
  put('docs/그림 한글.png'); put('A&B.md');
  put('README.md', '<img src="docs/그림%20한글.png">\n<a href="A&amp;B.md">안내</a>\n<!-- <img src="없는그림.png"> -->');
  expect(checkDocLinks(root, ['README.md'])).toEqual({ files: 1, checked: 2, errors: [] });
});
it('HTML의 data-src나 다른 속성 값 안의 href 글자를 링크로 오인하지 않는다', () => {
  put('screen.png'); put('guide.md');
  put('README.md', '<img data-src="없는그림.png" src="screen.png" title="크기 > 0">\n<a onclick="const href=\'없는문서.md\'" href="guide.md">안내</a>');
  expect(checkDocLinks(root, ['README.md'])).toEqual({ files: 1, checked: 2, errors: [] });
});
it('외부·태그 고정 URL과 앵커·코드 예제를 검사하지 않는다', () => {
  put('README.md', '[웹](https://example.com/missing)\n[고정](https://github.com/org/repo/blob/v0.5.11/old.md)\n[메일](mailto:qa@example.com)\n[다른웹](//example.com/a)\n[제목](#제목)\n[현재](?raw=1#제목)\n`[예시](없는문서.md)`\n```md\n[예시](없는문서.md)\n<img src="없는그림.png">\n```');
  expect(checkDocLinks(root, ['README.md'])).toEqual({ files: 1, checked: 0, errors: [] });
});
it('없는 대상과 줄 번호를 보고하며 실제 문서를 바꾸지 않는다', () => {
  const body = '# 안내\n[누락](docs/없는문서.md)\n\n<img src="없는그림.png">'; put('README.md', body);
  const result = checkDocLinks(root, ['README.md']);
  expect(result.checked).toBe(2); expect(result.errors).toEqual([
    expect.objectContaining({ file: 'README.md', line: 2, target: 'docs/%EC%97%86%EB%8A%94%EB%AC%B8%EC%84%9C.md' }),
    expect.objectContaining({ file: 'README.md', line: 4, target: '없는그림.png' }),
  ]);
  expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(body);
});
it('한글·공백·파일명의 # 인코딩을 풀고 query와 fragment는 경로에서 뺀다', () => {
  put('docs/표 #1.md');
  put('README.md', '[표](docs/'+encodeURIComponent('표 #1.md')+'?raw=1#부분)');
  expect(checkDocLinks(root, ['README.md']).errors).toEqual([]);
});
it('저장소 루트 링크는 루트 기준으로 찾고 범위 밖·깨진 인코딩은 거부한다', () => {
  put('docs/안내.md', '[루트](/README.md)'); put('README.md', '[외부](../outside.md)\n<a href="%ZZ.md">주소</a>');
  writeFileSync(join(temporary, 'outside.md'), '밖');
  const result = checkDocLinks(root, ['docs/안내.md', 'README.md']);
  expect(result.checked).toBe(3); expect(result.errors.map(error => error.message)).toEqual(['저장소 밖을 가리킵니다.', '링크 주소를 해석할 수 없습니다.']);
});
it.skipIf(process.platform === 'win32')('저장소 밖 파일로 이어진 심볼릭 링크도 거부한다', () => {
  writeFileSync(join(temporary, 'outside.md'), '밖'); symlinkSync('../outside.md', join(root, 'linked.md')); put('README.md', '[밖](linked.md)');
  expect(checkDocLinks(root, ['README.md']).errors).toEqual([expect.objectContaining({ message: '저장소 밖을 가리킵니다.' })]);
});
it('Git 추적 문서와 새 문서를 포함하고 gitignore의 로컬 문서는 제외한다', () => {
  execFileSync('git', ['init', '-q'], { cwd: root });
  put('.gitignore', 'ignored.md\nnode_modules/\n'); put('README.md', '[새 문서](new.md)'); put('docs/안내.md');
  execFileSync('git', ['add', '.gitignore', 'README.md', 'docs/안내.md'], { cwd: root });
  put('new.md'); put('ignored.md', '[오류](missing)'); put('node_modules/ignored.md', '[오류](missing)');
  expect(markdownFiles(root)).toEqual(['README.md', 'docs/안내.md', 'new.md']);
  expect(checkDocLinks(root)).toEqual({ files: 3, checked: 1, errors: [] });
});
it('참조 정의를 실제 사용한 링크만 추출한다', () => {
  expect(markdownLinks('[문서][used]\n\n[used]: guide.md\n[unused]: absent.md')).toEqual([{ target: 'guide.md', line: 1 }]);
});
