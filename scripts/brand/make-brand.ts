// 이수모아 로고를 만든다. 로고는 여기 한 곳에서만 그리고, 나머지(화면·탭 아이콘·Windows 아이콘·문서)는 이 결과를 쓴다.
//
//   npm run brand
//
// 만드는 것
//   web/src/brand/glyphs.ts           화면(React)·사용설명서·소개 영상이 가져다 쓰는 로고 좌표
//   web/public/favicon.svg            브라우저 탭 아이콘
//   deploy/windows-desktop/app.ico    Windows 바탕화면·시작 메뉴 아이콘
//   docs/brand/                       공문·발표 자료에 쓰는 로고 파일(SVG·PNG)과 사용 안내
//
// 모양: 빨간 직인(2×2 네 글자) 안에 "이수 / 모아". 글자를 감싼 네 모서리 괄호는 이수증을 스캔해 한곳에 모은다는 뜻.
// 글자는 Wanted Sans(OFL-1.1)의 윤곽을 그림으로 옮겨 글꼴이 없는 곳에서도 똑같이 보인다.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Path2D } from '@napi-rs/canvas';
import fontkit from '@pdf-lib/fontkit';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FONT_DIR = join(ROOT, 'node_modules', 'wanted-sans', 'fonts', 'ttf');
const load = (name: string) => fontkit.create(readFileSync(join(FONT_DIR, name))) as unknown as Font;

interface Glyph {
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  advanceWidth: number;
  path: { transform(a: number, b: number, c: number, d: number, e: number, f: number): { toSVG(): string } };
}
interface Font {
  unitsPerEm: number;
  glyphForCodePoint(cp: number): Glyph;
  layout(text: string): { glyphs: Glyph[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[] };
}

export const RED = '#D23B2C';
export const INK = '#161B26';
export const INK_SOFT = '#4A5263';
export const NAVY = '#2438A6';
const NAME = '이수모아';
const DESCRIPTOR = '법정교육 이수증 종합 플랫폼';

const round = (d: string) => d.replace(/-?\d+\.\d+/g, (n) => String(Math.round(parseFloat(n) * 100) / 100));

/**
 * 글자 하나를 앉힌 윤곽. 가로는 실제 획의 가운데를 cx에 맞추고,
 * 세로는 같은 줄의 글자들이 같은 바탕선에 앉도록 줄 전체(rowChars)의 가운데를 cy에 맞춘다.
 */
function centered(font: Font, ch: string, size: number, cx: number, cy: number, rowChars = ch): string {
  const g = font.glyphForCodePoint(ch.codePointAt(0)!);
  const s = size / font.unitsPerEm;
  const row = [...rowChars].map((c) => font.glyphForCodePoint(c.codePointAt(0)!).bbox);
  const rowMid = (Math.min(...row.map((b) => b.minY)) + Math.max(...row.map((b) => b.maxY))) / 2;
  const ox = cx - ((g.bbox.minX + g.bbox.maxX) / 2) * s;
  const oy = cy + rowMid * s;
  return round(g.path.transform(s, 0, 0, -s, ox, oy).toSVG());
}

/** 글줄을 윤곽으로 (왼쪽 끝 x, 글줄 바닥 y). tracking은 글자 크기에 대한 비율. 너비도 돌려준다 */
function line(font: Font, text: string, size: number, x: number, y: number, tracking = 0): { d: string; width: number } {
  const run = font.layout(text);
  const s = size / font.unitsPerEm;
  let pen = x;
  const parts: string[] = [];
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i];
    parts.push(g.path.transform(s, 0, 0, -s, pen + p.xOffset * s, y - p.yOffset * s).toSVG());
    pen += p.xAdvance * s + tracking * size;
  });
  return { d: round(parts.join(' ')), width: pen - x - tracking * size };
}

// ── 직인 ─────────────────────────────────────────────────

interface Variant {
  radius: number;
  /** 글자 크기(em)와 두 칸(가로)·두 줄(세로)의 가운데 */
  size: number;
  near: number;
  far: number;
  rowNear: number;
  rowFar: number;
  brackets: boolean;
}
// full: 큰 곳(로그인·문서·큰 아이콘) — 모서리 괄호가 있다. compact: 작은 곳(메뉴·탭·작은 아이콘) — 괄호를 빼고 글자를 키운다
const FULL: Variant = { radius: 22, size: 29.5, near: 35, far: 65, rowNear: 33.5, rowFar: 66.5, brackets: true };
const COMPACT: Variant = { radius: 20, size: 40, near: 28.5, far: 71.5, rowNear: 27.5, rowFar: 72.5, brackets: false };

const ARM = 16;
const INSET = 10;
const R = 4.5;
/** 네 모서리 괄호 하나로 이은 선 */
const BRACKETS = [
  `M${INSET} ${INSET + ARM}V${INSET + R}a${R} ${R} 0 0 1 ${R} ${-R}H${INSET + ARM}`,
  `M${100 - INSET - ARM} ${INSET}H${100 - INSET - R}a${R} ${R} 0 0 1 ${R} ${R}V${INSET + ARM}`,
  `M${100 - INSET} ${100 - INSET - ARM}V${100 - INSET - R}a${R} ${R} 0 0 1 ${-R} ${R}H${100 - INSET - ARM}`,
  `M${INSET + ARM} ${100 - INSET}H${INSET + R}a${R} ${R} 0 0 1 ${-R} ${-R}V${100 - INSET - ARM}`,
].join('');
const BRACKET_WIDTH = 3.6;

const black = load('WantedSans-Black.ttf');
const extraBold = load('WantedSans-ExtraBold.ttf');
const medium = load('WantedSans-Medium.ttf');

function glyphs(v: Variant): string[] {
  const cells: [number, number, string][] = [
    [v.near, v.rowNear, NAME.slice(0, 2)],
    [v.far, v.rowNear, NAME.slice(0, 2)],
    [v.near, v.rowFar, NAME.slice(2)],
    [v.far, v.rowFar, NAME.slice(2)],
  ];
  return [...NAME].map((ch, i) => centered(black, ch, v.size, cells[i][0], cells[i][1], cells[i][2]));
}
const FULL_GLYPHS = glyphs(FULL);
const COMPACT_GLYPHS = glyphs(COMPACT);

/** 직인 SVG 조각 (viewBox 0 0 100 100) */
function sealSvg(v: Variant, glyphPaths: string[], fg = '#fff', bg = RED): string {
  return [
    `<rect width="100" height="100" rx="${v.radius}" fill="${bg}"/>`,
    v.brackets ? `<path d="${BRACKETS}" fill="none" stroke="${fg}" stroke-width="${BRACKET_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>` : '',
    `<path d="${glyphPaths.join('')}" fill="${fg}"/>`,
  ].join('');
}

const svgDoc = (w: number, h: number, body: string, title = NAME) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

// ── 가로 로고(직인 + 이름 + 설명) ────────────────────────────

function lockup(ink: string, soft: string): { svg: string; width: number; height: number; body: string } {
  const mark = 124;
  const x = mark + 30;
  const name = line(extraBold, NAME, 88, x, 82, -0.03);
  const desc = line(medium, DESCRIPTOR, 24.5, x + 2, 114, 0);
  const width = Math.ceil(x + Math.max(name.width, desc.width + 2) + 4);
  const body = `<g transform="scale(${mark / 100})">${sealSvg(FULL, FULL_GLYPHS)}</g><path d="${name.d}" fill="${ink}"/><path d="${desc.d}" fill="${soft}"/>`;
  return { svg: svgDoc(width, mark, body), width, height: mark, body };
}

// ── 그림(PNG)·ICO ───────────────────────────────────────

function drawSeal(ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>, v: Variant, glyphPaths: string[], size: number, x = 0, y = 0) {
  const k = size / 100;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.roundRect(0, 0, 100, 100, v.radius);
  ctx.fill();
  if (v.brackets) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = BRACKET_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(BRACKETS));
  }
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(glyphPaths.join('')));
  ctx.restore();
}

function sealPng(size: number, variant: 'full' | 'compact'): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  if (variant === 'full') drawSeal(ctx, FULL, FULL_GLYPHS, size);
  else drawSeal(ctx, COMPACT, COMPACT_GLYPHS, size);
  return canvas.toBuffer('image/png');
}

/** 16px는 네 글자가 뭉개지므로 '모' 한 글자만 크게 */
function tinyPng(size: number): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const k = size / 100;
  ctx.scale(k, k);
  ctx.fillStyle = RED;
  ctx.beginPath();
  ctx.roundRect(0, 0, 100, 100, 20);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fill(new Path2D(centered(black, '모', 78, 50, 50)));
  return canvas.toBuffer('image/png');
}

function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

// ── 쓰기 ─────────────────────────────────────────────────

const write = (path: string, data: string | Buffer) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`  ${path.replace(ROOT, '')}`);
};

write(
  join(ROOT, 'web', 'src', 'brand', 'glyphs.ts'),
  `// 자동 생성 파일 — npm run brand (scripts/brand/make-brand.ts). 직접 고치지 마세요.
// 이수모아 직인 로고의 좌표 (viewBox 0 0 100 100). 글자는 Wanted Sans(OFL-1.1) 윤곽.

export const SEAL_RED = '${RED}';
export const NAME = '${NAME}';
export const DESCRIPTOR = '${DESCRIPTOR}';

export const MARK = {
  /** 큰 곳: 모서리 괄호가 있다 */
  full: { radius: ${FULL.radius}, bracketsPath: '${BRACKETS}', bracketsWidth: ${BRACKET_WIDTH}, glyphs: ${JSON.stringify(FULL_GLYPHS)} },
  /** 작은 곳: 괄호를 빼고 글자를 키웠다 */
  compact: { radius: ${COMPACT.radius}, glyphs: ${JSON.stringify(COMPACT_GLYPHS)} },
} as const;
`,
);

write(join(ROOT, 'web', 'public', 'favicon.svg'), svgDoc(100, 100, sealSvg(COMPACT, COMPACT_GLYPHS)));

write(
  join(ROOT, 'deploy', 'windows-desktop', 'app.ico'),
  ico([
    { size: 256, png: sealPng(256, 'full') },
    { size: 128, png: sealPng(128, 'full') },
    { size: 64, png: sealPng(64, 'full') },
    { size: 48, png: sealPng(48, 'compact') },
    { size: 32, png: sealPng(32, 'compact') },
    { size: 24, png: sealPng(24, 'compact') },
    { size: 16, png: tinyPng(16) },
  ]),
);

// 공문·발표 자료용
const BRAND = join(ROOT, 'docs', 'brand');
write(join(BRAND, 'isumoa-mark.svg'), svgDoc(100, 100, sealSvg(FULL, FULL_GLYPHS)));
write(join(BRAND, 'isumoa-mark-1024.png'), sealPng(1024, 'full'));
write(join(BRAND, 'isumoa-mark-compact.svg'), svgDoc(100, 100, sealSvg(COMPACT, COMPACT_GLYPHS)));

const light = lockup(INK, INK_SOFT);
write(join(BRAND, 'isumoa-lockup.svg'), light.svg);
const dark = lockup('#FFFFFF', 'rgba(255,255,255,.72)');
write(join(BRAND, 'isumoa-lockup-reverse.svg'), dark.svg);

/** 가로 로고를 PNG로 (SVG 윤곽을 그대로 그린다) */
function renderLockupPng(ink: string, soft: string, scale: number, background?: string): Buffer {
  const l = lockup(ink, soft);
  const pad = 16; // 문서에 바로 붙여 넣을 수 있게 둘레에 여백을 둔다
  const canvas = createCanvas(Math.round((l.width + pad * 2) * scale), Math.round((l.height + pad * 2) * scale));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.scale(scale, scale);
  ctx.translate(pad, pad);
  drawSeal(ctx, FULL, FULL_GLYPHS, 124);
  const x = 154;
  const name = line(extraBold, NAME, 88, x, 82, -0.03);
  const desc = line(medium, DESCRIPTOR, 24.5, x + 2, 114, 0);
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(name.d));
  ctx.fillStyle = soft;
  ctx.fill(new Path2D(desc.d));
  return canvas.toBuffer('image/png');
}
write(join(BRAND, 'isumoa-lockup.png'), renderLockupPng(INK, INK_SOFT, 6));
write(join(BRAND, 'isumoa-lockup-reverse.png'), renderLockupPng('#FFFFFF', 'rgba(255,255,255,0.72)', 6, NAVY));
