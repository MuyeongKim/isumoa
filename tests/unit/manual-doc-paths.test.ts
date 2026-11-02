/// <reference path="../../web/src/markdown-it.d.ts" />
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { manualPage } from '../../web/manualPlugin.ts';

it.each(['/', '/kmy/edu-cert/'])('문서 이동 후에도 설명서 그림 주소·크기와 하위 경로를 유지한다: %s', base => {
  const plugin = manualPage() as unknown as {
    configResolved(config: { base: string }): void;
    transformIndexHtml: { handler(html: string, ctx: { filename: string }): string };
  };
  plugin.configResolved({ base });
  const html = plugin.transformIndexHtml.handler('<!--MANUAL-->', { filename: '/manual.html' });
  expect(html).toContain('사용설명서');
  const images = [...html.matchAll(/<img src="([^"]+)"[^>]*>/g)];
  expect(images).toHaveLength(13);
  for (const image of images) {
    expect(image[1]).toMatch(new RegExp(`^${base.replace(/\/$/, '')}/manual/images/[^/]+$`));
    expect(image[0]).toMatch(/width="\d+" height="\d+"/);
    const file = fileURLToPath(new URL('../../docs/images/' + image[1].split('/').at(-1), import.meta.url));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file).length).toBeGreaterThan(0);
  }
  expect(html).not.toContain('/manual/../');
  expect(html).not.toContain('버전 0.3');
  expect(html).toContain('배포 ZIP을 푼 폴더의 <strong>PC설치안내.txt');
  expect(html).toContain('href="#1-처음-시작하기"');
  expect(html).not.toContain('소개·모의자료·핵심 사용 흐름');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  for (const link of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(decodeURIComponent(link[1])), `설명서 내부 링크: #${link[1]}`).toBe(true);
  expect(html).not.toContain('class="doc-ref"');
});
