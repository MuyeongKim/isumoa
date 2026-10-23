// README·사용설명서에 넣을 화면 그림을 찍는다 (docs/images/*.webp).
// 가상 자료(npm run samples, samples:certs, samples:forms)로 띄운 개발 서버를 대상으로 한다. 실존 인물·기관 아님.
//
//   npm run dev  (또는 데모 자료로 띄운 서버 + vite)
//   ECP_DEMO_LOGIN=admin ECP_DEMO_PASSWORD=… npm run media:screens
//
// 이미 있는 그림은 덮어쓴다. 특정 그림만: npm run media:screens -- dashboard palette

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, sleep, type Page } from './cdp.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = join(ROOT, 'docs', 'images');
const BASE = process.env.ECP_BASE_URL ?? 'http://localhost:5173';
const LOGIN = process.env.ECP_DEMO_LOGIN ?? 'admin';
const PASSWORD = process.env.ECP_DEMO_PASSWORD;
if (!PASSWORD) throw new Error('ECP_DEMO_PASSWORD 환경 변수에 데모 관리자 비밀번호를 넣어 주세요.');
const only = process.argv.slice(2);

const W = 1440;
const H = 900;

async function save(page: Page, name: string) {
  writeFileSync(join(OUT, `${name}.webp`), await page.screenshot('webp', 88));
  console.log(`  ${name}.webp`);
}

async function open(page: Page, path: string, ready: string) {
  await page.goto(`${BASE}${path}`);
  await page.waitFor(ready);
  await sleep(900); // 화면 전환·처음 열 때 움직임이 끝나도록
}

/** 개발 서버(vite)가 내주는 프로젝트 안 파일을 받아 파일 칸에 넣는다 (폴더 이름은 디스크에 NFD로 저장돼 있다) */
async function dropFile(page: Page, inputSelector: string, relative: string) {
  const fileName = relative.split('/').at(-1)!;
  await page.eval(`(async () => {
    const root = '/@fs' + ${JSON.stringify(ROOT)}.normalize('NFD');
    const res = await fetch(root + ${JSON.stringify(relative)}.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error('샘플 파일을 받지 못했습니다: ' + res.status);
    const file = new File([await res.blob()], ${JSON.stringify(fileName)});
    const input = document.querySelector(${JSON.stringify(inputSelector)});
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

/** React가 관리하는 select 값을 바꾼다 */
async function choose(page: Page, selector: string, value: string) {
  await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

const SHOTS: Record<string, (page: Page) => Promise<void>> = {
  async dashboard(page) {
    await open(page, '/', `document.querySelectorAll('[aria-label="칸 모양 설명"]').length && document.querySelectorAll('ul[aria-label$="직원"] button').length > 20`);
    await sleep(1200);
    // 화면 안에 보이는, 일부 이수한 직원 칸에 마우스를 올려 남은 교육 카드를 띄운다
    const target = await page.eval<{ x: number; y: number }>(`(() => {
      const b = [...document.querySelectorAll('ul[aria-label$="직원"] button')].find(
        (x) => x.getAttribute('aria-label').includes('일부 이수') && x.getBoundingClientRect().y < innerHeight - 160,
      );
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.mouse('mouseMoved', target.x, target.y);
    await sleep(500);
    await save(page, 'dashboard');
  },

  async palette(page) {
    await open(page, '/', `document.querySelector('ul[aria-label$="직원"] button')`);
    await sleep(800);
    await page.key('k', 'KeyK', 2); // Ctrl
    await page.waitFor(`document.querySelector('[role=combobox]')`);
    await page.type('ㄱㅁ');
    await page.waitFor(`document.querySelectorAll('[role=option]').length > 1 && [...document.querySelectorAll('[role=option]')].some((o) => o.id.startsWith('employee-'))`);
    await sleep(400);
    await save(page, 'palette');
    await page.key('Escape', 'Escape');
  },

  async upload(page) {
    await open(page, '/upload', `document.querySelector('#cert-files')`);
    await save(page, 'upload');
  },

  async review(page) {
    await open(page, '/review', `document.querySelector('[aria-label="이수증 목록"] button') && document.querySelector('#certificate-form')`);
    // 이름과 교육을 읽어 낸 이수증을 고른다 (표지·빈 쪽 말고)
    await page.eval(`[...document.querySelectorAll('[aria-label="이수증 목록"] button')].find((b) => !/이름 없음|교육 미정/.test(b.innerText))?.click()`);
    await sleep(800);
    await page.waitFor(`[...document.querySelectorAll('img[alt="이수증 원본"]')].some((i) => i.complete && i.naturalWidth > 0)`);
    await sleep(500);
    await save(page, 'review');
  },

  async status(page) {
    await open(page, '/status', `document.querySelectorAll('table button[aria-label]').length > 20`);
    const cell = await page.eval<{ x: number; y: number }>(`(() => {
      const b = document.querySelectorAll('table tbody tr')[5].querySelectorAll('button')[2];
      const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await page.mouse('mouseMoved', cell.x, cell.y);
    await sleep(400);
    await save(page, 'status');
  },

  async employees(page) {
    await open(page, '/employees', `document.querySelectorAll('table tbody tr').length > 5`);
    await save(page, 'employees');
  },

  async import(page) {
    await open(page, '/employees/import', `document.querySelector('input[type=file]')`);
    await dropFile(page, 'input[type=file]', 'samples/직원명단_변경분.xlsx');
    await page.waitFor(`document.body.innerText.includes('머리글')`);
    await sleep(700);
    await save(page, 'import');
  },

  async forms(page) {
    await open(page, '/export/forms', `document.querySelector('#form-file')`);
    await save(page, 'forms');
    await dropFile(page, '#form-file', 'samples/forms/2_두줄머리글_합계_서명란.xlsx');
    await page.waitFor(`document.body.innerText.includes('양식에서 찾은 자리')`);
    await sleep(700);
    await save(page, 'form-layout');
    await page.eval(`[...document.querySelectorAll('h2')].find((h) => h.textContent.includes('열마다'))?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -24)`);
    await page.waitFor(`document.body.innerText.includes('3. 미리보기')`);
    await sleep(900);
    await save(page, 'form-columns');
  },

  async export(page) {
    await open(page, '/export', `[...document.querySelectorAll('h2')].some((h) => h.textContent.includes('제출 양식에 채우기'))`);
    await choose(page, 'select:not([aria-label])', '감사·점검 제출');
    await sleep(400);
    await save(page, 'export');
  },
};

mkdirSync(OUT, { recursive: true });
const browser = await Browser.launch();
try {
  // 로그인 화면은 따로 된 창에서 (쿠키 없음)
  if (only.length === 0 || only.includes('login')) {
    const guest = await browser.newPage({ width: W, height: H, scale: 2, incognito: true });
    await open(guest, '/login', `document.querySelector('#loginId')`);
    await save(guest, 'login');
  }

  const page = await browser.newPage({ width: W, height: H, scale: 2 });
  await page.goto(`${BASE}/login`);
  const status = await page.eval<number>(`fetch('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: JSON.stringify({ loginId: ${JSON.stringify(LOGIN)}, password: ${JSON.stringify(PASSWORD)} }),
  }).then((r) => r.status)`);
  if (status !== 200) throw new Error(`로그인하지 못했습니다 (${status}).`);

  for (const [name, shot] of Object.entries(SHOTS)) {
    if (only.length > 0 && !only.includes(name)) continue;
    try {
      await shot(page);
    } catch (err) {
      console.error(`  ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
} finally {
  await browser.close();
}
