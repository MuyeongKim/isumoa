// 설치본(zip)을 만든다.
//
//   npm run release                          → 서버용, 이 컴퓨터와 같은 OS용 (지금 쓰는 Node를 그대로 넣음)
//   npm run release -- --target linux-x64 --download-node
//   npm run release -- --target win-x64 --download-node
//   npm run release -- --target win-x64 --desktop --download-node   → Windows PC 설치판 (설치.bat)
//
// 다른 OS용은 nodejs.org에서 공식 Node(약 30MB)를 받아 SHA-256을 확인한 뒤 넣는다.
// 스캔본 OCR(kordoc)은 OS별 네이티브 모듈(onnxruntime-node, sharp)을 쓰므로 대상 OS용만 받아 넣고,
// 다른 OS용 네이티브 파일이 섞여 있으면 실패 처리한다.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ZipArchive } from 'archiver';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TARGETS = ['win-x64', 'linux-x64', 'darwin-arm64', 'darwin-x64'] as const;
type Target = (typeof TARGETS)[number];

const { values } = parseArgs({
  options: {
    target: { type: 'string' },
    'download-node': { type: 'boolean', default: false },
    desktop: { type: 'boolean', default: false },
  },
});
const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const target = (values.target ?? hostTarget) as Target;
if (!TARGETS.includes(target)) throw new Error(`지원하지 않는 대상입니다: ${target} (가능: ${TARGETS.join(', ')})`);
const desktop = values.desktop;
if (desktop && target !== 'win-x64') throw new Error('PC 설치판(--desktop)은 win-x64용만 만듭니다.');
// npm·Node가 쓰는 이름 (win-x64 → win32, x64)
const [targetOs, targetCpu] = [target.startsWith('win') ? 'win32' : target.split('-')[0], target.split('-')[1]];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const nodeVersion = process.versions.node;
const name = desktop ? `이수모아-설치-${pkg.version}-${target}` : `isumoa-${pkg.version}-${target}`;
const releaseDir = join(ROOT, 'release');
const outDir = join(releaseDir, name);
// PC 설치판: program 폴더가 통째로 %LOCALAPPDATA%\Programs\isumoa로 복사된다
const programDir = desktop ? join(outDir, 'program') : outDir;
const appDir = join(programDir, 'app');

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function step(message: string) {
  console.log(`\n▶ ${message}`);
}

function walkFiles(dir: string, visit: (relative: string) => void, prefix = '') {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkFiles(dir, visit, relative);
    else visit(relative);
  }
}

const OS_NAMES = ['win32', 'linux', 'darwin', 'android', 'freebsd'];
const NATIVE_FILE = /\.(node|dll|dylib|so(\.\d+)*)$/;

/** onnxruntime-node는 한 패키지에 모든 OS용 엔진을 담고 있다 — 대상 OS·CPU용만 남긴다 */
function pruneOtherPlatforms(modules: string) {
  const base = join(modules, 'onnxruntime-node', 'bin', 'napi-v6');
  for (const os of readdirSync(base)) {
    if (os !== targetOs) rmSync(join(base, os), { recursive: true, force: true });
    else for (const cpu of readdirSync(join(base, os))) if (cpu !== targetCpu) rmSync(join(base, os, cpu), { recursive: true, force: true });
  }
}

/**
 * 네이티브 파일(.node·.dll·.so·.dylib)은 대상 OS·CPU용만 있어야 하고, OCR에 꼭 필요한 것은 있어야 한다.
 * 다른 OS용이 섞이면 설치본이 쓸데없이 커지거나, 그 파일을 먼저 집어 실행되지 않는다.
 */
function checkNativeModules(modules: string) {
  const wrong: string[] = [];
  let count = 0;
  walkFiles(modules, (relative) => {
    if (!NATIVE_FILE.test(relative)) return;
    count++;
    const lower = relative.toLowerCase();
    const otherOs = OS_NAMES.some((os) => os !== targetOs && lower.includes(os));
    if (!lower.includes(targetOs) || !lower.includes(targetCpu) || otherOs || lower.includes('musl')) wrong.push(relative);
  });
  if (wrong.length > 0) throw new Error(`${target}용이 아닌 네이티브 파일이 들어 있습니다:\n${wrong.join('\n')}`);
  const required = [
    `onnxruntime-node/bin/napi-v6/${targetOs}/${targetCpu}/onnxruntime_binding.node`,
    `@img/sharp-${targetOs}-${targetCpu}/package.json`,
    ...(targetOs === 'win32' ? [] : [`@img/sharp-libvips-${targetOs}-${targetCpu}/package.json`]),
  ];
  const missing = required.filter((path) => !existsSync(join(modules, path)));
  if (missing.length > 0) throw new Error(`OCR 엔진에 필요한 ${target}용 파일이 없습니다:\n${missing.join('\n')}`);
  console.log(`  ${target}용 네이티브 파일 ${count}개 확인 (onnxruntime-node, sharp)`);
}

/** 실행에 쓰이지 않는 타입 선언·소스맵을 뺀다 (파일 수가 많으면 Windows에서 압축 풀기·설치가 느리다) */
function pruneDevFiles(modules: string): number {
  let removed = 0;
  walkFiles(modules, (relative) => {
    if (/\.(map|d\.[cm]?ts)$/.test(relative)) {
      rmSync(join(modules, relative));
      removed++;
    }
  });
  return removed;
}

/** Windows 탐색기는 260자가 넘는 경로를 풀지 못한다 — 설치·압축 해제 위치를 더해도 넉넉한지 */
function longestPath(dir: string): string {
  let longest = '';
  walkFiles(dir, (relative) => {
    if (relative.length > longest.length) longest = relative;
  });
  return longest;
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`내려받기 실패 (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function addNodeRuntime() {
  const nodeDir = join(programDir, 'node');
  if (target === hostTarget) {
    // 지금 쓰는 Node 실행 파일을 그대로 복사
    const binDir = target.startsWith('win') ? nodeDir : join(nodeDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, target.startsWith('win') ? 'node.exe' : 'node');
    copyFileSync(process.execPath, exe);
    chmodSync(exe, 0o755);
    return;
  }
  if (!values['download-node']) {
    throw new Error(
      `${target}용 Node 실행 파일이 필요합니다. nodejs.org에서 받아도 되면 --download-node를 붙여 다시 실행하세요.`,
    );
  }
  const archiveName = `node-v${nodeVersion}-${target}.${target.startsWith('win') ? 'zip' : 'tar.xz'}`;
  const base = `https://nodejs.org/dist/v${nodeVersion}`;
  // 한 번 받은 Node는 release/.cache에 두고 다시 쓴다 (쓸 때마다 공식 SHA-256과 대조)
  const cached = join(releaseDir, '.cache', archiveName);
  if (!existsSync(cached)) console.log(`  ${base}/${archiveName} 받는 중…`);
  const [archive, sums] = await Promise.all([
    existsSync(cached) ? readFileSync(cached) : download(`${base}/${archiveName}`),
    download(`${base}/SHASUMS256.txt`),
  ]);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .find((line) => line.endsWith(`  ${archiveName}`))
    ?.split(' ')[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected || expected !== actual) throw new Error(`${archiveName}의 SHA-256이 공식 값과 다릅니다.`);
  console.log(`  SHA-256 확인: ${actual}`);
  if (!existsSync(cached)) {
    mkdirSync(join(releaseDir, '.cache'), { recursive: true });
    writeFileSync(cached, archive);
  }

  const tmp = join(releaseDir, `.node-${target}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const archivePath = join(tmp, archiveName);
  writeFileSync(archivePath, archive);
  run('tar', ['-xf', archivePath, '-C', tmp], ROOT);
  renameSync(join(tmp, archiveName.replace(/\.(zip|tar\.xz)$/, '')), nodeDir);
  rmSync(tmp, { recursive: true, force: true });
}

const CONFIG = {
  host: '0.0.0.0',
  port: 8080,
  dataDir: 'data',
  cookieSecure: false,
  sessionIdleMinutes: 60,
  sessionMaxHours: 12,
  trustProxy: false,
  // HTTPS 인증서: { "certFile": "cert/server.crt", "keyFile": "cert/server.key" } (설치가이드의 "HTTPS" 참고)
  tls: null,
  // 백업 폴더는 데이터와 다른 디스크(또는 NAS)를 권한다. 매일 backupHour시(한국 시각)에 자동 백업
  backupDir: 'backups',
  backupHour: 2,
  logDir: 'logs',
};

// .bat 파일은 윈도우 명령 창에서 한글이 깨지지 않도록 영문만 쓴다
const START_BAT = [
  '@echo off',
  'cd /d "%~dp0"',
  'set "ECP_CONFIG=%~dp0config.json"',
  '"%~dp0node\\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\\server\\src\\index.ts"',
  'pause',
  '',
].join('\r\n');

// 판독 정확도 점검 (설치가이드의 "판독 정확도 점검" 참고). chcp 65001: 결과의 한글이 깨지지 않게
const EVAL_BAT = [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'set "ECP_CONFIG=%~dp0config.json"',
  '"%~dp0node\\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\\scripts\\eval-ocr.ts" %*',
  '',
].join('\r\n');

const EVAL_SH = `#!/bin/sh
# 판독 정확도 점검 — 예: ./eval.sh --truth confirmed
cd "$(dirname "$0")" || exit 1
export ECP_CONFIG="$PWD/config.json"
exec ./node/bin/node --disable-warning=ExperimentalWarning app/scripts/eval-ocr.ts "$@"
`;

const RESTORE_BAT = [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'set "ECP_CONFIG=%~dp0config.json"',
  '"%~dp0node\\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\\scripts\\restore.ts" %*',
  '',
].join('\r\n');

const RESTORE_SH = `#!/bin/sh
# 백업 복원·복원 연습 — 예: ./restore.sh --check
cd "$(dirname "$0")" || exit 1
export ECP_CONFIG="$PWD/config.json"
exec ./node/bin/node --disable-warning=ExperimentalWarning app/scripts/restore.ts "$@"
`;

const START_SH = `#!/bin/sh
# 이수모아 실행
cd "$(dirname "$0")" || exit 1
export ECP_CONFIG="$PWD/config.json"
exec ./node/bin/node --disable-warning=ExperimentalWarning app/server/src/index.ts
`;

/** PC 설치판은 맨 위 폴더 없이 묶는다 — "모두 압축 풀기"가 zip 이름으로 폴더를 하나 만들므로 경로가 짧아진다 */
function zip(source: string, destination: string, root: string | false): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(source, root);
    void archive.finalize();
  });
}

/** Windows PowerShell 5.1은 BOM 없는 .ps1을 ANSI로 읽어 한글이 깨진다. .bat·.ps1은 Windows 줄바꿈으로 */
function writeWindowsText(path: string, text: string, bom: boolean) {
  writeFileSync(path, (bom ? '\uFEFF' : '') + text.replace(/^\uFEFF/, '').replace(/\r?\n/g, '\r\n'));
}

step(`설치본 만들기: ${name} (Node ${nodeVersion})`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });

step('화면 빌드');
run('npm', ['run', 'build'], ROOT);

step('프로그램 파일 복사');
for (const dir of ['server', 'shared', 'vendor']) cpSync(join(ROOT, dir), join(appDir, dir), { recursive: true });
cpSync(join(ROOT, 'web', 'dist'), join(appDir, 'web', 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json']) copyFileSync(join(ROOT, file), join(appDir, file));
mkdirSync(join(appDir, 'scripts'), { recursive: true });
for (const script of ['eval-ocr.ts', 'restore.ts']) copyFileSync(join(ROOT, 'scripts', script), join(appDir, 'scripts', script));

step(`실행에 필요한 라이브러리만 설치 (개발 도구 제외, ${targetOs}-${targetCpu}용 네이티브 모듈)`);
const platform = [`--os=${targetOs}`, `--cpu=${targetCpu}`, ...(targetOs === 'linux' ? ['--libc=glibc'] : [])];
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', ...platform], appDir);
pruneOtherPlatforms(join(appDir, 'node_modules'));
checkNativeModules(join(appDir, 'node_modules'));
console.log(`  타입 선언·소스맵 ${pruneDevFiles(join(appDir, 'node_modules'))}개 뺌`);
const longest = longestPath(appDir);
console.log(`  가장 긴 경로 ${longest.length}자: app/${longest}`);
if (longest.length > 160) throw new Error('경로가 너무 깁니다. Windows에서 압축을 풀거나 설치할 때 260자를 넘을 수 있습니다.');

step('Node 실행 파일 넣기');
await addNodeRuntime();
if (desktop) {
  // PC판은 node.exe만 쓴다 (npm·corepack 빼기 — 파일 약 1,800개)
  const nodeDir = join(programDir, 'node');
  for (const entry of readdirSync(nodeDir)) {
    if (entry !== 'node.exe' && entry !== 'LICENSE') rmSync(join(nodeDir, entry), { recursive: true, force: true });
  }
}

if (desktop) {
  step('PC 설치판: 설치·실행·제거 스크립트와 안내');
  const source = join(ROOT, 'deploy', 'windows-desktop');
  for (const script of ['common.ps1', 'launch.ps1', 'uninstall.ps1']) {
    writeWindowsText(join(programDir, script), readFileSync(join(source, script), 'utf8'), true);
  }
  copyFileSync(join(source, 'app.ico'), join(programDir, 'app.ico'));
  writeFileSync(join(programDir, 'VERSION'), `${pkg.version}\r\n`);
  mkdirSync(join(outDir, 'setup'), { recursive: true });
  writeWindowsText(join(outDir, 'setup', 'install.ps1'), readFileSync(join(source, 'install.ps1'), 'utf8'), true);
  writeWindowsText(join(outDir, '설치.bat'), readFileSync(join(source, 'install.bat'), 'utf8'), false);
  // 메모장으로 바로 열리게 .txt로
  writeWindowsText(join(outDir, 'PC설치안내.txt'), readFileSync(join(ROOT, 'docs', 'PC설치안내.md'), 'utf8'), true);
  await finish(false);
  process.exit(0);
}

step('실행 스크립트·설정·안내 문서');
writeFileSync(join(outDir, 'config.json'), JSON.stringify(CONFIG, null, 2) + '\n');
writeFileSync(join(outDir, 'start.bat'), START_BAT);
writeFileSync(join(outDir, 'start.sh'), START_SH);
chmodSync(join(outDir, 'start.sh'), 0o755);
writeFileSync(join(outDir, 'eval.bat'), EVAL_BAT);
writeFileSync(join(outDir, 'eval.sh'), EVAL_SH);
chmodSync(join(outDir, 'eval.sh'), 0o755);
writeFileSync(join(outDir, 'restore.bat'), RESTORE_BAT);
writeFileSync(join(outDir, 'restore.sh'), RESTORE_SH);
chmodSync(join(outDir, 'restore.sh'), 0o755);
// 서비스 등록: Windows는 작업 스케줄러(따로 받을 프로그램 없음), Linux는 systemd
const serviceDir = join(outDir, 'service');
mkdirSync(serviceDir, { recursive: true });
for (const os of ['windows', 'linux']) {
  for (const file of readdirSync(join(ROOT, 'deploy', os))) {
    const text = readFileSync(join(ROOT, 'deploy', os, file), 'utf8');
    // .bat은 Windows 줄바꿈이어야 cmd가 제대로 읽는다
    writeFileSync(join(serviceDir, file), file.endsWith('.bat') ? text.replace(/\r?\n/g, '\r\n') : text);
    if (file.endsWith('.sh')) chmodSync(join(serviceDir, file), 0o755);
  }
}
for (const doc of ['설치가이드.md', '운영가이드.md', 'IT-확인요청서.md']) {
  if (existsSync(join(ROOT, 'docs', doc))) copyFileSync(join(ROOT, 'docs', doc), join(outDir, doc));
}

await finish(name);

async function finish(root: string | false) {
  step('압축');
  const zipPath = join(releaseDir, `${name}.zip`);
  rmSync(zipPath, { force: true });
  await zip(outDir, zipPath, root);
  const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  console.log(`\n완료: ${zipPath}\n  크기 ${(statSync(zipPath).size / 1024 ** 2).toFixed(1)}MB · SHA-256 ${sha256}`);
}
