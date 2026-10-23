import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TlsConfig {
  /** PEM 인증서 파일 (중간 인증서까지 이어 붙인 것) */
  certFile?: string;
  /** PEM 개인키 파일 */
  keyFile?: string;
  /** 또는 PFX(.pfx/.p12) 파일 하나 */
  pfxFile?: string;
  passphrase?: string;
}

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  /** HTTPS로 운영할 때만 true (쿠키에 Secure 표시). tls를 쓰면 저절로 true */
  cookieSecure: boolean;
  /** 이 시간(분) 동안 아무 요청이 없으면 자동 로그아웃 */
  sessionIdleMinutes: number;
  /** 로그인 후 최대 유지 시간(시간) */
  sessionMaxHours: number;
  /** 리버스 프록시 뒤에서 운영할 때 실제 접속 IP를 기록하기 위해 true */
  trustProxy: boolean;
  /** 이 서버가 직접 HTTPS를 맡을 때 인증서 (파일 경로는 config.json 기준) */
  tls: TlsConfig | null;
  /** 백업을 둘 폴더. 데이터와 다른 디스크(또는 NAS)를 권한다 */
  backupDir: string;
  /** 매일 자동 백업하는 시각 (한국 시각 0~23) */
  backupHour: number;
  /** 로그 파일 폴더 (없으면 화면에만 출력). 서비스로 실행할 때 필요 */
  logDir: string | null;
  /** PC 설치판: 이 PC에서 혼자 쓰는 모드 ("프로그램 끄기" 단추, 설치·제거 프로그램이 끌 수 있는 열쇠 파일) */
  desktop: boolean;
  /** 읽은 config.json 위치 (없으면 null) */
  configPath: string | null;
  /** 빌드된 화면 파일 위치 (없으면 API만 제공) */
  webDistDir: string;
}

type ConfigFile = Partial<Omit<AppConfig, 'webDistDir' | 'configPath'>>;

/** app 폴더(개발 중에는 프로젝트 폴더) */
export const APP_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * 설정 읽는 순서: 기본값 → config.json → 환경 변수.
 * config.json 위치는 ECP_CONFIG 환경 변수로 지정하고, 없으면 app 폴더와 그 위 폴더(설치본의 맨 위)에서 찾는다.
 * dataDir 같은 상대 경로는 config.json이 있는 폴더 기준이다.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configPath = env.ECP_CONFIG ?? [join(APP_ROOT, 'config.json'), join(APP_ROOT, '..', 'config.json')].find((p) => existsSync(p));
  let file: ConfigFile = {};
  let baseDir = APP_ROOT;
  if (configPath && existsSync(configPath)) {
    // 메모장으로 고친 파일의 BOM은 떼고 읽는다
    file = JSON.parse(readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')) as ConfigFile;
    baseDir = dirname(configPath);
  }
  const path = (p: string | undefined) => (p ? resolve(baseDir, p) : undefined);
  const tls = file.tls && (file.tls.pfxFile || (file.tls.certFile && file.tls.keyFile))
    ? { certFile: path(file.tls.certFile), keyFile: path(file.tls.keyFile), pfxFile: path(file.tls.pfxFile), passphrase: file.tls.passphrase }
    : null;

  return {
    host: env.HOST ?? file.host ?? '127.0.0.1',
    port: Number(env.PORT ?? file.port ?? 3000),
    dataDir: resolve(baseDir, env.DATA_DIR ?? file.dataDir ?? 'data'),
    cookieSecure: tls !== null || (env.COOKIE_SECURE ?? String(file.cookieSecure ?? false)) === 'true',
    sessionIdleMinutes: Number(file.sessionIdleMinutes ?? 60),
    sessionMaxHours: Number(file.sessionMaxHours ?? 12),
    trustProxy: Boolean(file.trustProxy ?? false),
    tls,
    backupDir: resolve(baseDir, env.BACKUP_DIR ?? file.backupDir ?? 'backups'),
    backupHour: Math.min(23, Math.max(0, Number(file.backupHour ?? 2))),
    logDir: path(env.LOG_DIR ?? file.logDir ?? undefined) ?? null,
    desktop: Boolean(file.desktop ?? false),
    configPath: configPath && existsSync(configPath) ? configPath : null,
    webDistDir: join(APP_ROOT, 'web', 'dist'),
  };
}
