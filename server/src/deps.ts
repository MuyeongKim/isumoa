import type { Kysely } from 'kysely';
import type { AppConfig } from './config.ts';
import type { DB } from './db/schema.ts';
import type { Worker } from './jobs/queue.ts';
import type { OcrEngine } from './ocr/engine.ts';

/** 라우트 파일들이 함께 받는 의존성 */
export interface Deps {
  db: Kysely<DB>;
  config: AppConfig;
  version: string;
  /** 쪽 처리 대기열 일꾼 (테스트에서는 없을 수 있음) */
  worker?: Pick<Worker, 'notify' | 'averageMs'>;
  /** 쓰고 있는 OCR 엔진 (시스템 점검에 보여 줌) */
  ocr?: Pick<OcrEngine, 'label' | 'fallbackReason'>;
}
