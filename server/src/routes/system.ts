import { stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BackupStatus, SystemCheck } from '../../../shared/types.ts';
import { requireAdmin } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { HttpError } from '../lib/errors.ts';
import { backupStatus, runBackup } from '../ops/backup.ts';
import { loadRetention } from '../ops/retention.ts';

// 설정 > 시스템 점검, 설정 > 백업·보관(백업 부분), 그리고 감시 프로그램용 /api/health

const GB = 1024 ** 3;

async function size(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** 두 경로가 같은 디스크에 있는지 (백업을 같은 디스크에 두면 디스크 고장 때 함께 잃는다) */
async function sameDisk(a: string, b: string): Promise<boolean> {
  try {
    return (await stat(a)).dev === (await stat(b)).dev;
  } catch {
    return false;
  }
}

export async function systemRoutes(app: FastifyInstance, { db, config, version, ocr }: Deps) {
  const startedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();

  // 로그인 없이: 살아 있는지만 알려 준다 (서버 감시용)
  app.get('/api/health', async () => ({ ok: true, version }));

  app.get('/api/system', { preHandler: requireAdmin }, async (): Promise<SystemCheck> => {
    const dbPath = join(config.dataDir, 'app.db');
    const disk = await statfs(config.dataDir).catch(() => null);
    const backups = await backupStatus(db, config);
    const warnings: string[] = [];

    const https = config.tls !== null;
    if (!https && !config.trustProxy && !['127.0.0.1', 'localhost', '::1'].includes(config.host)) {
      warnings.push('HTTPS가 꺼져 있습니다. 내부망이라도 비밀번호와 이수증 개인정보가 암호화되지 않은 채 오갑니다. 설치가이드의 "HTTPS" 대로 인증서를 넣어 주세요.');
    }
    if (config.trustProxy && !config.cookieSecure) {
      warnings.push('리버스 프록시 뒤에서 운영 중입니다. 프록시가 HTTPS를 맡는다면 config.json의 cookieSecure를 true로 바꿔 주세요.');
    }
    const free = disk ? disk.bavail * disk.bsize : null;
    if (free !== null && free < 5 * GB) warnings.push(`데이터 디스크 남은 공간이 ${(free / GB).toFixed(1)}GB입니다. 5GB 넘게 비워 두세요.`);
    if (!backups.last) warnings.push('아직 백업한 적이 없습니다. 설정 > 백업·보관에서 "지금 백업"을 눌러 확인해 주세요.');
    else if (!backups.last.ok) warnings.push(`마지막 백업이 실패했습니다: ${backups.last.error}`);
    else if (Date.now() - Date.parse(backups.last.at) > 2 * 86_400_000) warnings.push('마지막 백업이 이틀 넘게 지났습니다. 서버 시각과 백업 폴더를 확인해 주세요.');
    if (backups.last?.ok && (await sameDisk(config.dataDir, config.backupDir))) {
      warnings.push('백업 폴더가 데이터와 같은 디스크에 있습니다. 디스크가 고장 나면 함께 잃으므로 config.json의 backupDir을 다른 디스크나 NAS로 바꿔 주세요.');
    }
    if (ocr?.fallbackReason) {
      warnings.push(`기본 OCR(kordoc)을 띄우지 못해 tesseract로 읽고 있습니다. 스캔본 정확도가 낮을 수 있습니다: ${ocr.fallbackReason}`);
    }
    if (config.sessionIdleMinutes > 60) warnings.push(`자동 로그아웃 시간이 ${config.sessionIdleMinutes}분입니다. 60분 이하를 권합니다.`);

    return {
      version,
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      startedAt,
      dataDir: config.dataDir,
      dbBytes: (await size(dbPath)) + (await size(`${dbPath}-wal`)),
      freeBytes: free,
      totalBytes: disk ? disk.blocks * disk.bsize : null,
      https,
      cookieSecure: config.cookieSecure,
      host: config.host,
      port: config.port,
      ocrEngine: ocr?.label ?? '-',
      backup: backups.last,
      warnings,
    };
  });

  app.get('/api/backups', { preHandler: requireAdmin }, async (): Promise<BackupStatus> => backupStatus(db, config));

  app.post('/api/backups/run', { preHandler: requireAdmin }, async (req): Promise<BackupStatus> => {
    const status = await backupStatus(db, config);
    if (status.running) throw new HttpError(409, '이미 백업하는 중입니다. 잠시 뒤 다시 확인해 주세요.');
    const result = await runBackup(db, config, (await loadRetention(db)).backupKeep);
    await audit(db, req, 'backup.run', undefined, { ok: result.ok, file: result.file, copied: result.copiedFiles, error: result.error });
    return backupStatus(db, config);
  });
}
