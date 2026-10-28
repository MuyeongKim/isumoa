import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/src/config.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { verifyChain } from '../server/src/lib/logChain.ts';
import { checkSnapshot, listSnapshots } from '../server/src/ops/backup.ts';
import { fileHash as sha256, snapshotAssets, verifyAssets } from '../server/src/ops/backupAssets.ts';

// 백업 복원과 복원 연습.
//   npm run restore -- --list                  백업 목록
//   npm run restore -- --check [파일]           복원 연습: 백업본을 임시 폴더에서 열어 검사만 한다 (지금 데이터는 그대로)
//   npm run restore -- --apply [파일] --yes     실제 복원: 서버를 멈춘 뒤에 한다
// 설치본에서는 restore.bat(Windows) / restore.sh(Linux)로 같은 옵션을 쓴다.

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean', default: false },
    check: { type: 'boolean', default: false },
    apply: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

const config = loadConfig();
const snapshots = await listSnapshots(config.backupDir);

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

if (!args.list && !args.check && !args.apply) {
  console.log(`사용법:
  --list                백업 목록 (${config.backupDir})
  --check [파일 이름]    복원 연습: 백업본이 온전한지 검사만 합니다 (지금 데이터는 바뀌지 않음)
  --apply [파일 이름] --yes   서버를 멈춘 뒤 백업본으로 되돌립니다
파일 이름을 생략하면 가장 최근 백업을 씁니다.`);
  process.exit(0);
}

if (args.list) {
  if (snapshots.length === 0) fail(`백업이 없습니다: ${join(config.backupDir, 'db')}`);
  console.log(`백업 폴더: ${config.backupDir}`);
  for (const s of snapshots) console.log(`  ${s.file}  ${(s.bytes / 1024 / 1024).toFixed(1)}MB`);
  process.exit(0);
}

const chosen = positionals[0] ?? snapshots[0]?.file;
if (!chosen) fail(`백업이 없습니다: ${join(config.backupDir, 'db')}`);
const snapshotPath = join(config.backupDir, 'db', chosen);
if (!existsSync(snapshotPath)) fail(`백업 파일이 없습니다: ${snapshotPath}`);

/** 백업본 검사: 체크섬, SQLite 무결성, 감사 로그·접속기록 이어짐, 원본 파일이 백업 폴더에 있는지 */
async function check(): Promise<boolean> {
  console.log(`검사할 백업: ${snapshotPath}`);
  let ok = true;
  let assetChecksums: unknown;
  const manifestPath = snapshotPath.replace(/\.db$/, '.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sha256: string; assets?: unknown };
    assetChecksums = manifest.assets;
    const same = (await sha256(snapshotPath)) === manifest.sha256;
    console.log(`  체크섬(SHA-256)       ${same ? '일치' : '불일치 — 백업 뒤에 파일이 바뀌었습니다'}`);
    ok &&= same;
  } else {
    console.log('  체크섬(SHA-256)       기록 없음 (건너뜀)');
  }
  const integrity = checkSnapshot(snapshotPath);
  console.log(`  DB 무결성 검사        ${integrity === 'ok' ? '정상' : integrity}`);
  ok &&= integrity === 'ok';

  // 임시 사본으로 열어 본다 (원본 백업 파일은 건드리지 않음)
  const temp = mkdtempSync(join(tmpdir(), 'ecp-restore-check-'));
  try {
    const copy = join(temp, 'app.db');
    copyFileSync(snapshotPath, copy);
    const { db } = openDatabase(copy);
    const count = async (table: 'employees' | 'certificates' | 'files' | 'pages' | 'audit_log') =>
      Number((await db.selectFrom(table).select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow()).n);
    console.log(`  직원 ${await count('employees')}명 · 이수증 ${await count('certificates')}건 · 원본 파일 ${await count('files')}개 · 쪽 ${await count('pages')}개`);
    for (const table of ['audit_log', 'access_log'] as const) {
      const chain = await verifyChain(db, table);
      const label = table === 'audit_log' ? '감사 로그 이어짐' : '접속기록 이어짐 ';
      console.log(`  ${label}      ${chain.ok ? `정상 (${chain.checked}건)` : `이상: #${chain.brokenAt} ${chain.problem}`}`);
      ok &&= chain.ok;
    }
    await db.destroy();
    const assets = await snapshotAssets(snapshotPath, config.backupDir);
    if (assetChecksums !== undefined) {
      verifyAssets(assets, assetChecksums);
      console.log(`  원본·쪽·미리보기 체크섬  정상 (${assets.length}개)`);
    } else {
      console.log('  원본 체크섬·쪽 존재     정상 (이전 백업은 쪽 이미지 체크섬이 없어 원본 대조가 필요합니다)');
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(ok ? '\n✔ 이 백업으로 복원할 수 있습니다.' : '\n✖ 이 백업에 문제가 있습니다. 다른 백업을 고르세요 (--list).');
  return ok;
}

async function copyMissing(source: string, target: string): Promise<number> {
  let n = 0;
  let entries: string[] = [];
  try {
    entries = await readdir(source, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  for (const rel of entries) {
    const from = join(source, rel);
    if (!(await stat(from)).isFile()) continue;
    const to = join(target, rel);
    if (existsSync(to) && (await stat(to)).size === (await stat(from)).size && await sha256(to) === await sha256(from)) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    n++;
  }
  return n;
}

async function serverRunning(): Promise<boolean> {
  const hosts = [...new Set(['127.0.0.1', '::1', ...(!['0.0.0.0', '::'].includes(config.host) ? [config.host] : [])])];
  const attempts = hosts.map(host => new Promise<boolean>(resolve => {
    const socket = connect({ host, port: config.port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  }));
  return (await Promise.all(attempts)).some(Boolean);
}

let healthy: boolean;
try { healthy = await check(); }
catch (error) { fail(`백업 검사 실패: ${error instanceof Error ? error.message : String(error)}`); }
if (args.check) process.exit(healthy ? 0 : 1);

// 실제 복원 ────────────────────────────────────────────────
if (!healthy) fail('검사를 통과하지 못한 백업으로는 복원하지 않습니다.');
if (!args.yes) fail('지금 데이터를 이 백업으로 바꿉니다. 정말 하려면 --yes를 붙여 다시 실행하세요.');
if (await serverRunning()) fail(`서버가 실행 중입니다(포트 ${config.port}). 서버(서비스)를 먼저 멈춘 뒤 다시 실행하세요.`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const keep = join(config.dataDir, `restore-before-${stamp}`);
mkdirSync(config.dataDir, { recursive: true });
const staged = join(config.dataDir, `restore-staged-${stamp}.db`);
let copied = 0;
const moved: string[] = [];
let restoreError: unknown;
try {
  // 필요한 파일 복사와 DB 사본 준비가 끝나야 기존 DB를 교체한다.
  for (const folder of ['files', 'pages']) copied += await copyMissing(join(config.backupDir, folder), join(config.dataDir, folder));
  copyFileSync(snapshotPath, staged);
  if (await sha256(staged) !== await sha256(snapshotPath)) throw new Error('복사한 DB 사본의 체크섬이 다릅니다.');
  mkdirSync(keep, { recursive: true });
  for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
    const from = join(config.dataDir, name);
    if (existsSync(from)) { renameSync(from, join(keep, name)); moved.push(name); }
  }
  renameSync(staged, join(config.dataDir, 'app.db'));
} catch (error) {
  for (const name of moved.reverse()) renameSync(join(keep, name), join(config.dataDir, name));
  restoreError = error;
} finally { rmSync(staged, { force: true }); }
if (restoreError) fail(`복원을 마치지 못했습니다. 기존 DB는 유지됩니다. ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
console.log(`\n✔ 복원했습니다: ${chosen}`);
console.log(`  원래 DB는 ${keep} 에 옮겨 두었습니다.`);
console.log(`  백업에서 되살린 파일 ${copied}개`);
console.log('  이제 서버를 다시 시작하세요.');
