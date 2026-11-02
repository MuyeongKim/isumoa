import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanWindowsPayload, writeProgramManifest } from '../../scripts/windows-exe.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'isumoa-win-payload-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
function file(path: string, text = '가상 실행 파일') { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); }
function link(path: string, target: string) { mkdirSync(join(root, path, '..'), { recursive: true }); symlinkSync(target, join(root, path)); }
function links(dir: string): string[] { return readdirSync(dir).flatMap(name => { const path = join(dir, name), stat = lstatSync(path); return stat.isSymbolicLink() ? [path] : stat.isDirectory() ? links(path) : []; }); }

it.each(['파일', '디렉터리', '숨긴 파일', 'manifest 자체'])('manifest가 %s 링크를 해시 목록으로 확정하지 않는다', kind => {
  file('runtime/내용.txt');
  if (kind === '파일') link('runtime/alias.txt', '내용.txt');
  if (kind === '디렉터리') link('alias', 'runtime');
  if (kind === '숨긴 파일') link('.hidden', 'runtime/내용.txt');
  if (kind === 'manifest 자체') link('program-manifest.json', 'runtime/내용.txt');
  expect(() => writeProgramManifest(root, '0.5.11')).toThrow(/심볼릭 링크/);
  expect(readFileSync(join(root, 'runtime/내용.txt'), 'utf8')).toBe('가상 실행 파일');
  if (kind !== 'manifest 자체') expect(existsSync(join(root, 'program-manifest.json'))).toBe(false);
});

it('심볼릭 링크인 프로그램 루트도 정리·manifest 생성을 거부한다', () => {
  mkdirSync(join(root, 'actual'));
  link('program', 'actual');
  expect(() => cleanWindowsPayload(join(root, 'program'))).toThrow(/심볼릭 링크/);
  expect(() => writeProgramManifest(join(root, 'program'), '0.5.11')).toThrow(/심볼릭 링크/);
});

it('최상위·중첩 node_modules의 .bin을 지우고 런타임 내용·일반 .bin 폴더는 보존한다', () => {
  file('app/node_modules/pkg/cli.js', '실제 모듈');
  file('app/node_modules/pkg/node_modules/deep/cli.js', '중첩 모듈');
  link('app/node_modules/.bin/tool', '../pkg/cli.js');
  link('app/node_modules/pkg/node_modules/.bin/deep', '../deep/cli.js');
  link('app/node_modules/pkg/node_modules/.bin/broken', '../missing');
  file('app/node_modules/pkg/node_modules/.bin/tool.cmd', 'Windows 명령');
  file('app/.bin/not-npm.txt', '유지');
  const result = cleanWindowsPayload(root);
  expect(result.removedBinDirectories).toEqual(['app/node_modules/.bin', 'app/node_modules/pkg/node_modules/.bin']);
  expect(result.removedLinks).toEqual([
    { path: 'app/node_modules/.bin/tool', target: '../pkg/cli.js' },
    { path: 'app/node_modules/pkg/node_modules/.bin/broken', target: '../missing' },
    { path: 'app/node_modules/pkg/node_modules/.bin/deep', target: '../deep/cli.js' },
  ]);
  expect(result.materializedLinks).toEqual([]);
  expect(links(root)).toEqual([]);
  for (const path of result.removedBinDirectories) expect(existsSync(join(root, path))).toBe(false);
  expect(readFileSync(join(root, 'app/node_modules/pkg/cli.js'), 'utf8')).toBe('실제 모듈');
  expect(readFileSync(join(root, 'app/.bin/not-npm.txt'), 'utf8')).toBe('유지');
  expect(cleanWindowsPayload(root)).toEqual({ removedBinDirectories: [], removedLinks: [], materializedLinks: [] });
});

it('남은 내부 파일·디렉터리 링크와 숨긴 내용은 실제 내용으로 바꾸고 manifest 크기·해시가 일치한다', () => {
  file('runtime/한글.txt', '설치 안내');
  file('runtime/.config.json', '{"local":true}');
  link('alias.txt', 'runtime/한글.txt');
  link('alias-directory', 'runtime');
  link('runtime/second.txt', '한글.txt');
  const result = cleanWindowsPayload(root);
  expect(result.materializedLinks).toEqual([
    { path: 'alias-directory', target: 'runtime' },
    { path: 'alias.txt', target: 'runtime/한글.txt' },
    { path: 'runtime/second.txt', target: 'runtime/한글.txt' },
  ]);
  expect(links(root)).toEqual([]);
  expect(readFileSync(join(root, 'alias-directory/.config.json'), 'utf8')).toBe('{"local":true}');
  expect(readFileSync(join(root, 'alias-directory/second.txt'), 'utf8')).toBe('설치 안내');
  writeProgramManifest(root, '0.5.11');
  const manifest = JSON.parse(readFileSync(join(root, 'program-manifest.json'), 'utf8'));
  expect(manifest.version).toBe('0.5.11');
  expect(manifest.files.some((entry: { path: string }) => entry.path === 'runtime/.config.json')).toBe(true);
  expect(manifest.files.some((entry: { path: string }) => entry.path === 'program-manifest.json')).toBe(false);
  for (const entry of manifest.files) {
    const content = readFileSync(join(root, entry.path));
    expect(entry.bytes).toBe(content.length);
    expect(entry.sha256).toBe(createHash('sha256').update(content).digest('hex'));
  }
});

it('node_modules 자체가 내부 링크여도 npm 명령은 남기지 않는다', () => {
  file('modules/pkg/index.js', '모듈');
  link('modules/.bin/tool', '../pkg/index.js');
  link('app/node_modules', '../modules');
  cleanWindowsPayload(root);
  expect(links(root)).toEqual([]);
  expect(existsSync(join(root, 'app/node_modules/.bin'))).toBe(false);
  expect(readFileSync(join(root, 'app/node_modules/pkg/index.js'), 'utf8')).toBe('모듈');
});

it.each(['끊긴', '외부', '디렉터리 순환', '파일 순환', '내부 디렉터리 안의 외부'])('%s 링크를 런타임 파일로 몰래 포함하지 않고 실패한다', kind => {
  const program = join(root, 'program'); mkdirSync(program);
  if (kind === '끊긴') symlinkSync('missing', join(program, 'alias'));
  if (kind === '외부') { file('private.txt', '배포 밖 내용'); symlinkSync('../private.txt', join(program, 'alias')); }
  if (kind === '디렉터리 순환') symlinkSync('.', join(program, 'alias'));
  if (kind === '파일 순환') symlinkSync('alias', join(program, 'alias'));
  if (kind === '내부 디렉터리 안의 외부') {
    file('private.txt', '배포 밖 내용'); mkdirSync(join(program, 'runtime'));
    symlinkSync('../../private.txt', join(program, 'runtime/secret'));
    symlinkSync('runtime', join(program, 'alias'));
  }
  expect(() => cleanWindowsPayload(program)).toThrow(/Windows 배포/);
  expect(lstatSync(join(program, 'alias')).isSymbolicLink()).toBe(true);
  if (existsSync(join(root, 'private.txt'))) expect(readFileSync(join(root, 'private.txt'), 'utf8')).toBe('배포 밖 내용');
});
