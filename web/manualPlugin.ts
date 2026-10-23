import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import type { Plugin, ResolvedConfig } from 'vite';
import { MARK } from './src/brand/glyphs.ts';

// 사용설명서(docs/사용설명서.md)를 프로그램 안의 /manual.html 로 만든다.
// 내부망 PC는 GitHub를 볼 수 없으므로, 같은 글을 프로그램이 직접 보여 준다 (그림은 docs/images → /manual/images).

const SOURCE = fileURLToPath(new URL('../docs/사용설명서.md', import.meta.url));
const IMAGES = fileURLToPath(new URL('../docs/images/', import.meta.url));

/** 그림 크기 (WebP·JPEG 머리만 읽는다). 크기를 알려 주면 그림이 늦게 떠도 글이 밀리지 않는다 */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function sizeAttrs(src: string): string {
  try {
    const size = imageSize(readFileSync(IMAGES + src.replace(/^images\//, '')));
    return size ? ` width="${size.width}" height="${size.height}"` : '';
  } catch {
    return '';
  }
}

/** GitHub와 같은 방식의 제목 주소: "1. 처음 시작하기" → "1-처음-시작하기" */
export function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** base: 하위 경로에 올릴 때의 기준 경로 (예: /kmy/edu-cert). 기본(루트)이면 빈 글자 */
function render(markdown: string, base: string): { html: string; toc: { id: string; text: string }[] } {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const toc: { id: string; text: string }[] = [];

  md.renderer.rules.heading_open = (tokens, i, options, env, self) => {
    const text = tokens[i + 1].content;
    tokens[i].attrSet('id', slug(text));
    if (tokens[i].tag === 'h2') toc.push({ id: slug(text), text });
    return self.renderToken(tokens, i, options);
  };
  md.renderer.rules.image = (tokens, i) => {
    const token = tokens[i];
    const src = token.attrGet('src') ?? '';
    const alt = token.content;
    return `<figure><img src="${base}/manual/${src}" alt="${md.utils.escapeHtml(alt)}"${sizeAttrs(src)} loading="lazy"><figcaption>${md.utils.escapeHtml(alt)}</figcaption></figure>`;
  };
  // 다른 문서(.md)로 가는 링크는 프로그램 안에 없으므로 글자만 남긴다
  const plain: boolean[] = [];
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const href = tokens[i].attrGet('href') ?? '';
    const isDoc = /\.md(#.*)?$/.test(href);
    plain.push(isDoc);
    return isDoc ? '<span class="doc-ref">' : self.renderToken(tokens, i, options);
  };
  md.renderer.rules.link_close = (tokens, i, options, env, self) => (plain.pop() ? '</span>' : self.renderToken(tokens, i, options));

  const html = md.render(markdown).replace(/<p><figure>/g, '<figure>').replace(/<\/figure><\/p>/g, '</figure>');
  return { html, toc };
}

export function manualPage(): Plugin {
  let base = '';
  return {
    name: 'ecp-manual',
    configResolved(config: ResolvedConfig) {
      base = config.base.replace(/\/+$/, '');
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.endsWith('manual.html')) return html;
        const { html: body, toc } = render(readFileSync(SOURCE, 'utf8'), base);
        const nav = toc.map((t) => `<li><a href="#${t.id}">${t.text.replace(/^\d+\.\s*/, '')}</a></li>`).join('');
        return html.replace('<!--MANUAL-->', `
<div class="layout">
  <aside class="toc">
    <a class="brand" href="${base}/"><svg viewBox="0 0 100 100" width="36" height="36" role="img" aria-label="이수모아 로고"><rect width="100" height="100" rx="${MARK.compact.radius}" fill="#d23b2c"/><path d="${MARK.compact.glyphs.join('')}" fill="#fff"/></svg><span>이수모아</span></a>
    <p class="toc-title">사용설명서</p>
    <nav aria-label="차례"><ol>${nav}</ol></nav>
    <div class="toc-foot"><button type="button" id="print">인쇄·PDF로 저장</button><a href="${base}/">프로그램으로 돌아가기</a></div>
  </aside>
  <main class="doc">${body}</main>
</div>`);
      },
    },
    handleHotUpdate({ file, server }) {
      if (file === SOURCE) server.ws.send({ type: 'full-reload' });
    },
  };
}
