// 홍보용 모션그래픽을 만든다.
//   1. scripts/media/promo/promo.html에 Wanted Sans(쓰는 글자만 남긴 것)를 넣어 docs/promo/promo.html 로 (인터넷 없이 열림)
//   2. 헤드리스 크롬으로 한 장씩 찍어 ffmpeg로 docs/promo/promo.mp4 (1920×1080, 30fps)
//   3. 배경음악·효과음(scripts/media/audio.ts가 코드로 만듦)을 입혀 영상과 HTML에 넣는다
//   4. README용 미리보기 GIF(docs/images/promo-preview.gif)와 배너(docs/images/banner.jpg)
//
//   npm run media:promo                         전부
//   npm run media:promo -- --stills             장면별 정지 화면만 (임시 폴더에, 확인용)
//   npm run media:promo -- --audio-only         소리만 다시 만들어 영상에 입힌다 (화면은 그대로)
//   npm run media:promo -- --music 음원.mp3      배경음악을 기관이 쓸 수 있는 음원으로 (효과음은 그대로)
//
// 필요한 것: ffmpeg, python3 fonttools(pyftsubset), 크롬(scripts/media/cdp.ts 참고)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MARK } from '../../web/src/brand/glyphs.ts';
import { renderSoundtrack, SR, wav, type Cue } from './audio.ts';
import { Browser } from './cdp.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEMPLATE = join(ROOT, 'scripts', 'media', 'promo', 'promo.html');
const OUT_DIR = join(ROOT, 'docs', 'promo');
const IMAGES = join(ROOT, 'docs', 'images');
const FONT = join(ROOT, 'node_modules', 'wanted-sans', 'fonts', 'variable', 'WantedSansVariable.ttf');
const FPS = 30;
const stillsOnly = process.argv.includes('--stills');
const audioOnly = process.argv.includes('--audio-only');
const musicFile = process.argv.includes('--music') ? process.argv[process.argv.indexOf('--music') + 1] : null;

/** 기관이 준 음원을 48kHz 스테레오로 풀어 온다 */
function decodeMusic(file: string): { L: Float32Array; R: Float32Array } {
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  const L = new Float32Array(pcm.length / 2);
  const R = new Float32Array(pcm.length / 2);
  for (let i = 0; i < L.length; i++) {
    L[i] = pcm[i * 2];
    R[i] = pcm[i * 2 + 1];
  }
  return { L, R };
}

/** 템플릿에 쓰인 글자만 남긴 글꼴을 WOFF로 만들어 data URL로 넣는다 (Wanted Sans는 OFL — 함께 배포 가능) */
function buildHtml(audioDataUrl = 'AUDIO_SRC'): string {
  const tmp = mkdtempSync(join(tmpdir(), 'ecp-promo-font-'));
  const template = readFileSync(TEMPLATE, 'utf8');
  const chars = [...new Set([...template, ...'0123456789,.%·×'])].join('');
  writeFileSync(join(tmp, 'chars.txt'), chars);
  const out = join(tmp, 'font.woff');
  execFileSync('pyftsubset', [FONT, `--text-file=${join(tmp, 'chars.txt')}`, '--flavor=woff', '--layout-features=*', `--output-file=${out}`], { stdio: 'inherit' });
  const font = readFileSync(out).toString('base64');
  rmSync(tmp, { recursive: true, force: true });
  const face = `/* Wanted Sans Variable (SIL Open Font License 1.1, © Wanted Lab) — 이 영상에 쓰인 글자만 남김 */
@font-face { font-family: "Promo Sans"; font-weight: 400 1000; src: url(data:font/woff;base64,${font}) format("woff"); }`;
  // 로고는 web/src/brand/glyphs.ts(npm run brand가 만듦)의 좌표를 그대로 쓴다
  const svg = (variant: 'full' | 'compact') =>
    `<svg viewBox="0 0 100 100" role="img" aria-label="이수모아 로고"><rect width="100" height="100" rx="${MARK[variant].radius}" fill="#d23b2c"/>${
      variant === 'full' ? `<path d="${MARK.full.bracketsPath}" fill="none" stroke="#fff" stroke-width="${MARK.full.bracketsWidth}" stroke-linecap="round" stroke-linejoin="round"/>` : ''
    }<path d="${MARK[variant].glyphs.join('')}" fill="#fff"/></svg>`;
  return template
    .replace('/*FONT_FACE*/', face)
    .replace('<!--MARK_COMPACT-->', svg('compact'))
    .replace('<!--MARK_FULL-->', svg('full'))
    .replace('src="AUDIO_SRC"', `src="${audioDataUrl}"`);
}

mkdirSync(OUT_DIR, { recursive: true });
const htmlPath = join(OUT_DIR, 'promo.html');
writeFileSync(htmlPath, buildHtml());
console.log(`글꼴을 넣은 HTML: ${htmlPath}`);

const browser = await Browser.launch();
try {
  const page = await browser.newPage({ width: 1920, height: 1080, scale: 1 });
  await page.goto(`${pathToFileURL(htmlPath).href}?capture`);
  await page.eval('document.fonts.ready.then(() => true)');
  const total = await page.eval<number>('window.__total');
  const cues = await page.eval<Cue[]>('window.__cues');

  // 소리: 효과음 신호대로 배경음악·효과음을 만든다
  const sound = mkdtempSync(join(tmpdir(), 'ecp-promo-sound-'));
  const soundWav = join(sound, 'sound.wav');
  writeFileSync(soundWav, wav(renderSoundtrack(cues, total, { music: musicFile ? decodeMusic(musicFile) : undefined })));
  console.log(`소리: 효과음 ${cues.length}개${musicFile ? ` + 배경음악 ${musicFile}` : ' + 배경음악(코드로 만듦)'}`);
  const m4a = join(sound, 'sound.m4a');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', soundWav, '-c:a', 'aac', '-b:a', '128k', m4a]);
  const frameAt = async (ms: number, format: 'jpeg' | 'png' = 'jpeg') => {
    await page.eval(`window.__render(${ms})`);
    return page.screenshot(format, 94);
  };

  const mp4 = join(OUT_DIR, 'promo.mp4');
  if (audioOnly) {
    // 화면은 있는 영상 그대로, 소리만 바꾼다
    const out = join(sound, 'promo.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-i', soundWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    writeFileSync(mp4, readFileSync(out));
    console.log(`영상에 소리를 다시 입혔습니다: ${mp4}`);
  } else if (stillsOnly) {
    const dir = join(tmpdir(), 'ecp-promo-stills');
    mkdirSync(dir, { recursive: true });
    for (const ms of [3500, 5000, 9200, 11800, 17800, 19500, 23300, 25500, 30000, 34000, 40500, 42500, 47500]) {
      writeFileSync(join(dir, `t${String(ms).padStart(5, '0')}.jpg`), await frameAt(ms));
    }
    console.log(`정지 화면: ${dir}`);
  } else {
    const frames = mkdtempSync(join(tmpdir(), 'ecp-promo-frames-'));
    const count = Math.round((total / 1000) * FPS);
    for (let i = 0; i < count; i++) {
      writeFileSync(join(frames, `f${String(i).padStart(5, '0')}.jpg`), await frameAt((i * 1000) / FPS));
      if (i % 150 === 0) console.log(`  ${i}/${count}장`);
    }
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frames, 'f%05d.jpg'), '-i', soundWav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4],
      { stdio: 'inherit' },
    );
    console.log(`영상: ${mp4}`);

    // README 미리보기: 직원 지도가 채워지는 장면 7초
    const gif = join(IMAGES, 'promo-preview.gif');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '28.6', '-t', '7', '-i', mp4, '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif], { stdio: 'inherit' });
    console.log(`미리보기 GIF: ${gif}`);
    rmSync(frames, { recursive: true, force: true });
  }

  // 배너: 끝 화면의 가운데 띠
  const end = join(tmpdir(), 'ecp-promo-end.png');
  writeFileSync(end, await frameAt(total - 500, 'png'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', end, '-vf', 'crop=1920:820:0:120,scale=1600:-1:flags=lanczos', '-q:v', '3', join(IMAGES, 'banner.jpg')], { stdio: 'inherit' });
  console.log(`배너: ${join(IMAGES, 'banner.jpg')}`);

  // HTML에도 소리를 넣는다 ("소리 켜기"를 누르면 음악에 맞춰 재생)
  writeFileSync(htmlPath, buildHtml(`data:audio/mp4;base64,${readFileSync(m4a).toString('base64')}`));
  console.log(`소리를 넣은 HTML: ${htmlPath}`);
  rmSync(sound, { recursive: true, force: true });
} finally {
  await browser.close();
}
