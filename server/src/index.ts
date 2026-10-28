import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { processPage } from './certs/processPage.ts';
import { APP_ROOT, loadConfig, type AppConfig } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { seedDefaults } from './db/seed.ts';
import { sealAuditLog } from './lib/logChain.ts';
import { createLogStream } from './lib/logFile.ts';
import { maskStoredRrn } from './lib/privacy.ts';
import { openDatabase } from './db/sqlite.ts';
import { recoverInterruptedJobs, startWorker, type Worker } from './jobs/queue.ts';
import { createOcrEngine } from './ocr/engine.ts';
import { startScheduler } from './ops/scheduler.ts';

const version = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
// 설정이 잘못되면(예: 단일 사용자 모드인데 host가 바깥 주소) 이유만 보여 주고 멈춘다
let config: AppConfig;
try {
  config = loadConfig();
} catch (err) {
  console.error(`설정 오류: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
mkdirSync(config.dataDir, { recursive: true });

// HTTPS 인증서 (config.json의 tls). 파일을 읽지 못하면 시작하지 않는다 — 몰래 HTTP로 뜨지 않게
const https = config.tls
  ? config.tls.pfxFile
    ? { pfx: readFileSync(config.tls.pfxFile), passphrase: config.tls.passphrase }
    : { cert: readFileSync(config.tls.certFile!), key: readFileSync(config.tls.keyFile!), passphrase: config.tls.passphrase }
  : null;

const { raw, db } = openDatabase(join(config.dataDir, 'app.db'));
const applied = runMigrations(raw, { backupDir: join(config.dataDir, 'backups') });
await seedDefaults(db);
// 이전 버전에서 남은 감사 로그에 위·변조 확인용 hash를 채운다 (새 기록을 쓰기 전에)
const sealed = await sealAuditLog(db);
const masked = await maskStoredRrn(db);

// 일꾼은 앱보다 늦게 만들어지므로, 라우트에는 나중에 연결되는 손잡이를 넘긴다
let worker: Worker | null = null;
// PC 설치판: 설치·제거 프로그램이 이 서버를 끌 때 쓰는 열쇠 (이 PC 사용자 폴더에만 둔다)
const shutdownToken = config.desktop ? randomBytes(24).toString('hex') : undefined;
const tokenFile = join(dirname(config.configPath ?? config.dataDir), 'run', 'shutdown.token');

// 스캔본 OCR: kordoc(PP-OCRv5)을 먼저 띄워 보고, 안 되는 PC에서는 tesseract로 (ocr/engine.ts)
const ocr = await createOcrEngine({ modelDir: join(APP_ROOT, 'vendor', 'ocr-models'), prefer: process.env.ECP_OCR === 'tesseract' ? 'tesseract' : 'kordoc' });
const app = await buildApp(
  {
    db,
    config,
    version,
    ocr,
    shutdownToken,
    requestShutdown: (reason) => void shutdown(reason),
    worker: {
      notify: () => worker?.notify(),
      averageMs: () => worker?.averageMs() ?? null,
    },
  },
  { https, logger: config.logDir ? { level: 'info', stream: createLogStream(config.logDir) } : undefined },
);
if (applied.length > 0) app.log.info(`DB 구조를 적용했습니다: ${applied.join(', ')}`);
if (sealed > 0) app.log.info(`감사 로그 ${sealed}건에 위·변조 확인용 hash를 채웠습니다.`);
if (masked > 0) app.log.info(`저장된 글자 ${masked}쪽에서 주민등록번호 뒷자리를 가렸습니다.`);

const recovered = await recoverInterruptedJobs(db);
if (recovered > 0) app.log.info(`중단됐던 쪽 ${recovered}개를 다시 처리합니다.`);
worker = startWorker({ db, log: app.log, handle: (job) => processPage({ db, dataDir: config.dataDir, ocr }, job.page_id, job.review_generation) });
app.log.info(`스캔본 OCR: ${ocr.label}`);
if (config.singleUser) app.log.warn('단일 사용자 모드로 시작합니다: 앱 로그인 없이 모든 요청이 관리자로 처리됩니다. nginx 로그인으로 막혀 있어야 합니다.');
if (ocr.fallbackReason) app.log.warn(`kordoc OCR을 띄우지 못해 대신 tesseract로 읽습니다: ${ocr.fallbackReason}`);

const purgeTimer = setInterval(() => {
  purgeExpiredSessions(db, config.sessionIdleMinutes).catch((err) => app.log.error(err));
}, 10 * 60_000);
purgeTimer.unref();
const scheduler = startScheduler({ db, config, log: app.log });

let stopping = false;
async function shutdown(reason: string) {
  if (stopping) return;
  stopping = true;
  app.log.info(`종료합니다 (${reason}).`);
  scheduler.stop();
  if (shutdownToken) rmSync(tokenFile, { force: true });
  await app.close();
  await worker?.stop();
  await ocr.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
// 열쇠는 포트를 잡은 뒤에 쓴다 — 두 번째로 켠 서버가 실패하면서 켜져 있는 서버의 열쇠를 덮어쓰지 않게
if (shutdownToken) {
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, shutdownToken, { mode: 0o600 });
}
const shownHost = config.host === '0.0.0.0' ? '이 서버의 IP 주소' : config.host;
app.log.info(`이수모아 v${version} 실행 중 → ${https ? 'https' : 'http'}://${shownHost}:${config.port}`);
app.log.info(`데이터 폴더: ${config.dataDir} · 백업 폴더: ${config.backupDir} (매일 ${config.backupHour}시)`);
