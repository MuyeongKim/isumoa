// 문서 그림·홍보 영상을 만들 때 쓰는 아주 작은 크롬 조종기 (Chrome DevTools Protocol).
// 따로 받을 패키지 없이 Node 내장 WebSocket으로 헤드리스 크롬에 붙는다.
// 크롬 위치: CHROME_PATH 환경 변수 → Playwright가 받아 둔 헤드리스 셸 → 설치된 Google Chrome 순서로 찾는다.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

function findChrome(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const arch of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-linux64']) {
        const bin = join(cache, dir, arch, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  throw new Error('크롬을 찾지 못했습니다. CHROME_PATH 환경 변수로 위치를 알려 주세요.');
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class Browser {
  private ws!: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners: ((msg: { method: string; params: Record<string, unknown>; sessionId?: string }) => void)[] = [];
  private proc: ChildProcess;
  private profile: string;

  private constructor(proc: ChildProcess, profile: string) {
    this.proc = proc;
    this.profile = profile;
  }

  static async launch(): Promise<Browser> {
    const profile = mkdtempSync(join(tmpdir(), 'ecp-chrome-'));
    const proc = spawn(
      findChrome(),
      ['--headless', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', '--font-render-hinting=none', 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const endpoint = await new Promise<string>((resolve, reject) => {
      let buf = '';
      proc.stderr!.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) resolve(m[1]);
      });
      proc.on('exit', (code) => reject(new Error(`크롬이 바로 꺼졌습니다 (code ${code}).\n${buf}`)));
    });
    const browser = new Browser(proc, profile);
    browser.ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      browser.ws.onopen = resolve;
      browser.ws.onerror = () => reject(new Error('크롬에 연결하지 못했습니다.'));
    });
    browser.ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id && browser.pending.has(msg.id)) {
        const p = browser.pending.get(msg.id)!;
        browser.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const l of browser.listeners) l(msg);
      }
    };
    return browser;
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject }));
  }

  waitEvent(method: string, sessionId: string, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method}을(를) 기다리다 시간이 지났습니다.`)), timeoutMs);
      const listener = (msg: { method: string; params: Record<string, unknown>; sessionId?: string }) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.listeners = this.listeners.filter((l) => l !== listener);
          resolve(msg.params);
        }
      };
      this.listeners.push(listener);
    });
  }

  /** 새 탭. incognito면 쿠키를 나누지 않는 따로 된 창 */
  async newPage(options: { width: number; height: number; scale?: number; incognito?: boolean }): Promise<Page> {
    const context = options.incognito ? (await this.send<{ browserContextId: string }>('Target.createBrowserContext')).browserContextId : undefined;
    const { targetId } = await this.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId: context });
    const { sessionId } = await this.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this, sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    // 사용자는 Windows PC에서 쓰므로 화면도 Windows처럼 (예: 빠른 이동 단축키가 Ctrl K로 보이게)
    await page.send('Emulation.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      platform: 'Win32',
    });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.scale ?? 1,
      mobile: false,
    });
    return page;
  }

  async close() {
    try {
      await this.send('Browser.close');
    } catch {
      this.proc.kill();
    }
    await new Promise((r) => setTimeout(r, 300));
    rmSync(this.profile, { recursive: true, force: true });
  }
}

export class Page {
  private browser: Browser;
  readonly sessionId: string;

  constructor(browser: Browser, sessionId: string) {
    this.browser = browser;
    this.sessionId = sessionId;
  }

  send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.browser.send<T>(method, params, this.sessionId);
  }

  async goto(url: string) {
    const loaded = this.browser.waitEvent('Page.loadEventFired', this.sessionId);
    await this.send('Page.navigate', { url });
    await loaded;
  }

  /** 페이지 안에서 식을 계산해 값을 돌려받는다 (Promise면 기다림) */
  async eval<T = unknown>(expression: string): Promise<T> {
    const res = await this.send<{ result: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result.value as T;
  }

  /** 조건이 참이 될 때까지 기다린다 */
  async waitFor(expression: string, timeoutMs = 15_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await this.eval<boolean>(`Boolean(${expression})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`기다리던 화면이 나오지 않았습니다: ${expression}`);
  }

  async mouse(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1 });
  }

  async key(key: string, code: string, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  }

  async type(text: string) {
    await this.send('Input.insertText', { text });
  }

  async screenshot(format: 'png' | 'webp' | 'jpeg' = 'png', quality = 90): Promise<Buffer> {
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', { format, quality: format === 'png' ? undefined : quality });
    return Buffer.from(data, 'base64');
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
