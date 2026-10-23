import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../server/src/config.ts';
import { openDatabase } from '../server/src/db/sqlite.ts';
import { verifyChain } from '../server/src/lib/logChain.ts';
import { checkSnapshot, listSnapshots } from '../server/src/ops/backup.ts';

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

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** 백업본 검사: 체크섬, SQLite 무결성, 감사 로그·접속기록 이어짐, 원본 파일이 백업 폴더에 있는지 */
async function check(): Promise<boolean> {
  console.log(`검사할 백업: ${snapshotPath}`);
  let ok = true;
  const manifestPath = snapshotPath.replace(/\.db$/, '.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sha256: string };
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
    const files = await db.selectFrom('files').select(['id', 'stored_name', 'page_count']).execute();
    const pages = await db.selectFrom('pages').select(['file_id', 'page_no']).execute();
    const missingFiles = files.filter((f) => !existsSync(join(config.backupDir, 'files', f.stored_name))).length;
    const missingPages = pages.filter((p) => !existsSync(join(config.backupDir, 'pages', String(p.file_id), `${p.page_no}.jpg`))).length;
    console.log(`  백업 폴더의 원본 파일  ${missingFiles === 0 ? '모두 있음' : `${missingFiles}개 없음`} · 쪽 이미지 ${missingPages === 0 ? '모두 있음' : `${missingPages}개 없음`}`);
    // 사본보다 나중에 파기한 자료는 파일이 없을 수 있다 (경고만)
    await db.destroy();
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
  } catch {
    return 0;
  }
  for (const rel of entries) {
    const from = join(source, rel);
    if (!(await stat(from)).isFile()) continue;
    const to = join(target, rel);
    if (existsSync(to) && (await stat(to)).size === (await stat(from)).size) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    n++;
  }
  return n;
}

function serverRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: config.port });
    socket.setTimeout(1000);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

const healthy = await check();
if (args.check) process.exit(healthy ? 0 : 1);

// 실제 복원 ────────────────────────────────────────────────
if (!healthy) fail('검사를 통과하지 못한 백업으로는 복원하지 않습니다.');
if (!args.yes) fail('지금 데이터를 이 백업으로 바꿉니다. 정말 하려면 --yes를 붙여 다시 실행하세요.');
if (await serverRunning()) fail(`서버가 실행 중입니다(포트 ${config.port}). 서버(서비스)를 먼저 멈춘 뒤 다시 실행하세요.`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const keep = join(config.dataDir, `restore-before-${stamp}`);
mkdirSync(keep, { recursive: true });
for (const name of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const from = join(config.dataDir, name);
  if (existsSync(from)) renameSync(from, join(keep, name));
}
copyFileSync(snapshotPath, join(config.dataDir, 'app.db'));
let copied = 0;
// 백업에 있는 원본 파일·쪽 이미지를 데이터 폴더로 (데이터 폴더에만 있는 파일은 지우지 않는다)
for (const folder of ['files', 'pages']) copied += await copyMissing(join(config.backupDir, folder), join(config.dataDir, folder));

console.log(`\n✔ 복원했습니다: ${chosen}`);
console.log(`  원래 DB는 ${keep} 에 옮겨 두었습니다.`);
console.log(`  백업에서 되살린 파일 ${copied}개`);
console.log('  이제 서버를 다시 시작하세요.');
