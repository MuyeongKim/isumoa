import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { systemAudit } from '../lib/audit.ts';
import { runBackup, type BackupResult } from './backup.ts';
import { loadRetention, pruneLogs } from './retention.ts';

// 매일 하는 일: 보관기간 지난 기록 정리, 정해진 시각 이후 하루 한 번 백업.
// 서버가 그 시각에 꺼져 있었으면 켜진 뒤 그날 안에 백업한다.

const CHECK_MS = 5 * 60_000;

function seoulDate(d = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d);
}

function seoulHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(d));
}

export function startScheduler(options: { db: Kysely<DB>; config: AppConfig; log: FastifyBaseLogger }): { stop(): void } {
  const { db, config, log } = options;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const today = seoulDate();
      const retention = await loadRetention(db);

      if ((await getSetting(db, 'maintenanceDate', '')) !== today) {
        const pruned = await pruneLogs(db, retention);
        await setSetting(db, 'maintenanceDate', today);
        if (pruned.access + pruned.audit > 0) {
          await systemAudit(db, 'logs.prune', { ...pruned });
          log.info(`보관기간이 지난 접속기록 ${pruned.access}건, 감사 로그 ${pruned.audit}건을 지웠습니다.`);
        }
      }

      const last = await getSetting<BackupResult | null>(db, 'backupLast', null);
      const doneToday = last?.ok && seoulDate(new Date(last.at)) === today;
      if (!doneToday && seoulHour() >= config.backupHour && (last?.ok !== false || Date.now() - Date.parse(last.at) > 3_600_000)) {
        const result = await runBackup(db, config, retention.backupKeep);
        await systemAudit(db, 'backup.run', { ok: result.ok, file: result.file, copied: result.copiedFiles, error: result.error });
        if (result.ok) log.info(`자동 백업을 마쳤습니다: ${result.file} (파일 ${result.copiedFiles}개 복사, ${Math.round(result.ms / 1000)}초)`);
        else log.error(`자동 백업 실패: ${result.error}`);
      }
    } catch (err) {
      log.error(err, '예약 작업 중 오류');
    } finally {
      busy = false;
    }
  }

  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), CHECK_MS);
  timer.unref();
  first.unref();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
