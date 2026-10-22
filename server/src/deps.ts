import type { Kysely } from 'kysely';
import type { AppConfig } from './config.ts';
import type { DB } from './db/schema.ts';

/** 라우트 파일들이 함께 받는 의존성 */
export interface Deps {
  db: Kysely<DB>;
  config: AppConfig;
  version: string;
}
