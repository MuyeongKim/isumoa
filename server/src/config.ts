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
  /**
   * 단일 사용자 모드 (시범 서버 전용): 앱 로그인 없이, 세션이 없는 요청을 모두 첫 관리자로 처리한다.
   * 앞단(nginx 등)의 로그인이 유일한 보호이므로 host가 이 서버 안(127.0.0.1·localhost·::1)일 때만 켤 수 있다.
   */
  singleUser: boolean;
  /** 읽은 config.json 위치 (없으면 null) */
  configPath: string | null;
  /** 빌드된 화면 파일 위치 (없으면 API만 제공) */
  webDistDir: string;
}

type ConfigFile = Partial<Omit<AppConfig, 'webDistDir' | 'configPath'>>;

/** 단일 사용자 모드로 열어도 되는 host: 이 서버 안에서만 접속되는 주소 */
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

/**
 * 단일 사용자 모드는 앱이 사용자를 가리지 않으므로, 서버 바깥에서 곧바로 닿는 주소(0.0.0.0 등)로는 열 수 없다.
 * 설정을 읽을 때와 앱을 만들 때 둘 다 확인해, 어느 쪽으로 켜도 앞단을 거치지 않는 길이 생기지 않게 한다.
 */
export function assertSingleUserHost(config: Pick<AppConfig, 'singleUser' | 'host'>): void {
  if (config.singleUser && !LOOPBACK_HOSTS.includes(config.host.trim().toLowerCase())) {
    throw new Error(
      `단일 사용자 모드(singleUser)는 host가 127.0.0.1·localhost·::1일 때만 켤 수 있습니다 (지금 host: ${config.host}). ` +
        '로그인 없이 누구나 관리자가 되므로, 서버 바깥에서 바로 닿는 주소로는 시작하지 않습니다. ' +
        'host를 127.0.0.1로 바꾸고 nginx 같은 앞단의 로그인으로 막은 뒤 켜 주세요.',
    );
  }
}

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

  // 꺼짐이 기본: 문자열 "false"처럼 애매한 값이 켜짐으로 읽히지 않도록 true/false만 받는다
  if (file.singleUser !== undefined && typeof file.singleUser !== 'boolean') {
    throw new Error('config.json의 singleUser는 true 또는 false여야 합니다 (따옴표 없이).');
  }

  const config: AppConfig = {
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
    singleUser: file.singleUser === true,
    configPath: configPath && existsSync(configPath) ? configPath : null,
    webDistDir: path(env.WEB_DIST_DIR) ?? join(APP_ROOT, 'web', 'dist'),
  };
  assertSingleUserHost(config);
  return config;
}
