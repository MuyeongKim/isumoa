// 내부망 서버용 설치본(zip)을 만든다.
//
//   npm run release                          → 이 컴퓨터와 같은 OS용 (지금 쓰는 Node를 그대로 넣음)
//   npm run release -- --target win-x64 --download-node
//   npm run release -- --target linux-x64 --download-node
//
// 다른 OS용은 nodejs.org에서 공식 Node(약 30MB)를 받아 SHA-256을 확인한 뒤 넣는다.
// 설치본 안에는 네이티브 모듈(.node)이 없어야 한다 — 있으면 실패 처리한다.

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
  options: { target: { type: 'string' }, 'download-node': { type: 'boolean', default: false } },
});
const hostTarget = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const target = (values.target ?? hostTarget) as Target;
if (!TARGETS.includes(target)) throw new Error(`지원하지 않는 대상입니다: ${target} (가능: ${TARGETS.join(', ')})`);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const nodeVersion = process.versions.node;
const name = `edu-cert-platform-${pkg.version}-${target}`;
const releaseDir = join(ROOT, 'release');
const outDir = join(releaseDir, name);
const appDir = join(outDir, 'app');

function run(command: string, args: string[], cwd: string) {
  execFileSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function step(message: string) {
  console.log(`\n▶ ${message}`);
}

/** 설치본에 OS별로 컴파일된 파일이 섞이면 다른 OS 서버에서 실행되지 않는다 */
function assertNoNativeModules(dir: string) {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.node') || entry.name === 'binding.gyp') found.push(path);
    }
  };
  walk(dir);
  if (found.length > 0) throw new Error(`네이티브 모듈이 들어 있습니다:\n${found.join('\n')}`);
}

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`내려받기 실패 (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function addNodeRuntime() {
  const nodeDir = join(outDir, 'node');
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
  console.log(`  ${base}/${archiveName} 받는 중…`);
  const [archive, sums] = await Promise.all([download(`${base}/${archiveName}`), download(`${base}/SHASUMS256.txt`)]);
  const expected = sums
    .toString('utf8')
    .split('\n')
    .find((line) => line.endsWith(`  ${archiveName}`))
    ?.split(' ')[0];
  const actual = createHash('sha256').update(archive).digest('hex');
  if (!expected || expected !== actual) throw new Error(`${archiveName}의 SHA-256이 공식 값과 다릅니다.`);
  console.log(`  SHA-256 확인: ${actual}`);

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
# 법정교육 이수증 종합 플랫폼 실행
cd "$(dirname "$0")" || exit 1
export ECP_CONFIG="$PWD/config.json"
exec ./node/bin/node --disable-warning=ExperimentalWarning app/server/src/index.ts
`;

function zip(source: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(destination);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(source, name);
    void archive.finalize();
  });
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

step('실행에 필요한 라이브러리만 설치 (개발 도구 제외)');
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], appDir);
assertNoNativeModules(join(appDir, 'node_modules'));
console.log('  네이티브 모듈 없음 — 어떤 OS에서도 같은 파일로 실행됩니다.');

step('Node 실행 파일 넣기');
await addNodeRuntime();

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

step('압축');
const zipPath = join(releaseDir, `${name}.zip`);
rmSync(zipPath, { force: true });
await zip(outDir, zipPath);
console.log(`\n완료: ${zipPath}`);
