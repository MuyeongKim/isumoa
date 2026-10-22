import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/sessions.ts';
import { APP_ROOT, loadConfig } from './config.ts';
import { runMigrations } from './db/migrate.ts';
import { seedDefaults } from './db/seed.ts';
import { openDatabase } from './db/sqlite.ts';

const version = (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const { raw, db } = openDatabase(join(config.dataDir, 'app.db'));
const applied = runMigrations(raw, { backupDir: join(config.dataDir, 'backups') });
await seedDefaults(db);

const app = await buildApp({ db, config, version });
if (applied.length > 0) app.log.info(`DB 구조를 적용했습니다: ${applied.join(', ')}`);

const purgeTimer = setInterval(() => {
  purgeExpiredSessions(db, config.sessionIdleMinutes).catch((err) => app.log.error(err));
}, 10 * 60_000);
purgeTimer.unref();

async function shutdown(signal: string) {
  app.log.info(`${signal} 신호를 받아 종료합니다.`);
  await app.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
const shownHost = config.host === '0.0.0.0' ? '이 서버의 IP 주소' : config.host;
app.log.info(`법정교육 이수증 종합 플랫폼 v${version} 실행 중 → http://${shownHost}:${config.port}`);
app.log.info(`데이터 폴더: ${config.dataDir}`);
