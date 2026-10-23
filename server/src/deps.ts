import type { Kysely } from 'kysely';
import type { AiHealth } from './ai/health.ts';
import type { AppConfig } from './config.ts';
import type { DB } from './db/schema.ts';
import type { Worker } from './jobs/queue.ts';

/** 라우트 파일들이 함께 받는 의존성 */
export interface Deps {
  db: Kysely<DB>;
  config: AppConfig;
  version: string;
  /** 쪽 처리 대기열 일꾼 (테스트에서는 없을 수 있음) */
  worker?: Pick<Worker, 'notify' | 'averageMs' | 'concurrency' | 'setConcurrency'>;
  /** AI 서버 상태 (테스트에서는 없을 수 있음) */
  aiHealth?: AiHealth;
}
