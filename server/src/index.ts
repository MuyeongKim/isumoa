import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiHealth } from './ai/health.ts';
import { loadAiSettings } from './ai/settings.ts';
import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { processPage } from './certs/processPage.ts';
import { APP_ROOT, loadConfig } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { seedDefaults } from './db/seed.ts';
import { openDatabase } from './db/sqlite.ts';
import { MAX_ATTEMPTS, recoverInterruptedJobs, startWorker, type Worker } from './jobs/queue.ts';
import { createTesseractOcr } from './ocr/tesseract.ts';

const version = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const { raw, db } = openDatabase(join(config.dataDir, 'app.db'));
const applied = runMigrations(raw, { backupDir: join(config.dataDir, 'backups') });
await seedDefaults(db);

// 일꾼은 앱보다 늦게 만들어지므로, 라우트에는 나중에 연결되는 손잡이를 넘긴다
let worker: Worker | null = null;
const aiHealth = new AiHealth();
const app = await buildApp({
  db,
  config,
  version,
  aiHealth,
  worker: {
    notify: () => worker?.notify(),
    averageMs: () => worker?.averageMs() ?? null,
    concurrency: () => worker?.concurrency() ?? 1,
    setConcurrency: (n) => worker?.setConcurrency(n),
  },
});
if (applied.length > 0) app.log.info(`DB 구조를 적용했습니다: ${applied.join(', ')}`);

const recovered = await recoverInterruptedJobs(db);
if (recovered > 0) app.log.info(`중단됐던 쪽 ${recovered}개를 다시 처리합니다.`);
const ocr = createTesseractOcr();
const ai = await loadAiSettings(db);
worker = startWorker({
  db,
  log: app.log,
  concurrency: ai.enabled ? ai.concurrency : 1,
  handle: (job) => processPage({ db, dataDir: config.dataDir, ocr, config, aiHealth }, job.page_id, { finalAttempt: job.attempts >= MAX_ATTEMPTS }),
});
app.log.info(ai.enabled ? `AI 인식: ${ai.model} (${ai.provider === 'anthropic' ? 'Claude API' : ai.baseUrl})` : 'AI 인식: 꺼짐 (규칙으로만 읽습니다)');

const purgeTimer = setInterval(() => {
  purgeExpiredSessions(db, config.sessionIdleMinutes).catch((err) => app.log.error(err));
}, 10 * 60_000);
purgeTimer.unref();

async function shutdown(signal: string) {
  app.log.info(`${signal} 신호를 받아 종료합니다.`);
  await app.close();
  await worker?.stop();
  await ocr.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
const shownHost = config.host === '0.0.0.0' ? '이 서버의 IP 주소' : config.host;
app.log.info(`법정교육 이수증 종합 플랫폼 v${version} 실행 중 → http://${shownHost}:${config.port}`);
app.log.info(`데이터 폴더: ${config.dataDir}`);
