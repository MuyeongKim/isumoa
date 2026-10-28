import type { Kysely } from 'kysely';
import type { AppConfig } from './config.ts';
import type { DB } from './db/schema.ts';
import type { Worker } from './jobs/queue.ts';
import type { OcrEngine } from './ocr/engine.ts';

/** 라우트 파일들이 함께 받는 의존성 */
export interface Deps {
  updateRuntime?: import('./updates/service.ts').UpdateRuntime;
  db: Kysely<DB>;
  config: AppConfig;
  version: string;
  /** 쪽 처리 대기열 일꾼 (테스트에서는 없을 수 있음) */
  worker?: Pick<Worker, 'notify' | 'averageMs'>;
  /** 서버를 끈다 (PC 설치판의 "프로그램 끄기") */
  requestShutdown?: (reason: string) => void;
  /** PC 설치판에서 설치·제거 프로그램이 서버를 끌 때 내야 하는 열쇠 (run/shutdown.token 파일과 같은 값) */
  shutdownToken?: string;
  /** 쓰고 있는 OCR 엔진 (문서 가져오기·시스템 점검) */
  ocr?: OcrEngine;
}
