import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  /** HTTPS로 운영할 때만 true (쿠키에 Secure 표시) */
  cookieSecure: boolean;
  /** 이 시간(분) 동안 아무 요청이 없으면 자동 로그아웃 */
  sessionIdleMinutes: number;
  /** 로그인 후 최대 유지 시간(시간) */
  sessionMaxHours: number;
  /** 리버스 프록시 뒤에서 운영할 때 실제 접속 IP를 기록하기 위해 true */
  trustProxy: boolean;
  /** 빌드된 화면 파일 위치 (없으면 API만 제공) */
  webDistDir: string;
}

type ConfigFile = Partial<Omit<AppConfig, 'webDistDir'>>;

/** app 폴더(개발 중에는 프로젝트 폴더) */
export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 설정 읽는 순서: 기본값 → config.json → 환경 변수.
 * config.json 위치는 ECP_CONFIG 환경 변수로 지정하고, 없으면 app 폴더의 config.json을 찾는다.
 * dataDir 같은 상대 경로는 config.json이 있는 폴더 기준이다.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configPath = env.ECP_CONFIG ?? join(APP_ROOT, 'config.json');
  let file: ConfigFile = {};
  let baseDir = APP_ROOT;
  if (existsSync(configPath)) {
    file = JSON.parse(readFileSync(configPath, 'utf8')) as ConfigFile;
    baseDir = dirname(configPath);
  }

  return {
    host: env.HOST ?? file.host ?? '127.0.0.1',
    port: Number(env.PORT ?? file.port ?? 3000),
    dataDir: resolve(baseDir, env.DATA_DIR ?? file.dataDir ?? 'data'),
    cookieSecure: (env.COOKIE_SECURE ?? String(file.cookieSecure ?? false)) === 'true',
    sessionIdleMinutes: Number(file.sessionIdleMinutes ?? 60),
    sessionMaxHours: Number(file.sessionMaxHours ?? 12),
    trustProxy: Boolean(file.trustProxy ?? false),
    webDistDir: join(APP_ROOT, 'web', 'dist'),
  };
}
