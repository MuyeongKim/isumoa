// 저장소에 포함할 Markdown의 상대 링크만 검사한다. 외부 주소를 조회하거나 파일을 변경하지 않는다.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Token {
  type: string;
  content: string;
  map?: [number, number] | null;
  children?: Token[] | null;
  attrGet(name: string): string | null;
}
interface Parser {
  parse(markdown: string, env: Record<string, unknown>): Token[];
  utils: { unescapeAll(text: string): string };
}
// web 전용 타입 선언에 의존하지 않고 검사에 쓰는 부분만 명시한다.
const MarkdownIt = createRequire(import.meta.url)('markdown-it') as new (options: { html: boolean }) => Parser;
const md = new MarkdownIt({ html: true });

export interface DocLink { target: string; line: number }
export interface DocLinkError extends DocLink { file: string; message: string }

export function markdownLinks(markdown: string): DocLink[] {
  const links: DocLink[] = [];
  function visit(tokens: Token[], inheritedLine = 1) {
    for (const token of tokens) {
      const line = token.map ? token.map[0] + 1 : inheritedLine;
      if (token.type === 'link_open' || token.type === 'image') {
        const target = token.attrGet(token.type === 'image' ? 'src' : 'href');
        if (target) links.push({ target, line });
      }
      if (token.type === 'html_inline' || token.type === 'html_block') {
        const html = token.content.replace(/<!--[\s\S]*?-->/g, comment => comment.replace(/[^\n]/g, ' '));
        for (const tag of html.matchAll(/<[a-z][\w:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
          for (const attr of tag[0].matchAll(/\s+([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
            if (!['src', 'href'].includes(attr[1].toLowerCase())) continue;
            const target = md.utils.unescapeAll(attr[2] ?? attr[3] ?? attr[4]);
            if (target) links.push({ target, line: line + (html.slice(0, tag.index! + attr.index!).match(/\n/g)?.length ?? 0) });
          }
        }
      }
      if (token.children) visit(token.children, line);
    }
  }
  visit(md.parse(markdown, {}));
  return links;
}

export function markdownFiles(root: string): string[] {
  return [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'],
    { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))].sort();
}

function outside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path === '..' || path.startsWith('..' + sep) || isAbsolute(path);
}

export function checkDocLinks(root: string, files = markdownFiles(root)): { files: number; checked: number; errors: DocLinkError[] } {
  const base = resolve(root), physicalRoot = realpathSync(base), errors: DocLinkError[] = [];
  let checked = 0;
  for (const file of files) {
    const source = resolve(base, file);
    let markdown: string;
    try { markdown = readFileSync(source, 'utf8'); }
    catch { errors.push({ file, line: 1, target: file, message: '문서를 읽을 수 없습니다.' }); continue; }
    for (const link of markdownLinks(markdown)) {
      const target = link.target.trim();
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target)) continue;
      const path = target.split(/[?#]/, 1)[0];
      if (!path) continue;
      checked++;
      let decoded: string;
      try { decoded = decodeURIComponent(path); }
      catch { errors.push({ file, ...link, message: '링크 주소를 해석할 수 없습니다.' }); continue; }
      const destination = decoded.startsWith('/') ? resolve(base, '.' + decoded) : resolve(dirname(source), decoded);
      if (outside(base, destination)) { errors.push({ file, ...link, message: '저장소 밖을 가리킵니다.' }); continue; }
      try {
        const entry = statSync(destination);
        if (!entry.isFile() && !entry.isDirectory()) throw new Error('파일이 아닙니다.');
        if (outside(physicalRoot, realpathSync(destination))) errors.push({ file, ...link, message: '저장소 밖을 가리킵니다.' });
      } catch { errors.push({ file, ...link, message: '대상 파일이나 폴더를 찾을 수 없습니다.' }); }
    }
  }
  return { files: files.length, checked, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkDocLinks(fileURLToPath(new URL('../', import.meta.url)));
  for (const error of result.errors) console.error(`${error.file}:${error.line} ${error.target} — ${error.message}`);
  console.log(`문서 ${result.files}개 · 상대 링크 ${result.checked}개 · 깨진 링크 ${result.errors.length}개`);
  if (result.errors.length) process.exitCode = 1;
}
