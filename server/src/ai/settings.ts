import type { Kysely } from 'kysely';
import type { AiProbeResult, AiSettingsInput, AiSettingsView } from '../../../shared/types.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { isExternalAi, sameAiTarget } from '../../../shared/aiHosts.ts';
import { getSetting, setSetting } from '../db/seed.ts';

// AI 연결 설정. DB의 settings 표에 'ai' 이름으로 저장한다.
// API 키는 화면으로 돌려주지 않는다 (있는지만 알려 준다).

export interface AiSettings extends Omit<AiSettingsView, 'hasApiKey' | 'externalBlocked' | 'isExternal'> {
  apiKey: string | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:11434/v1',
  model: 'gemma4:12b-it-qat',
  apiKey: null,
  vision: 'auto',
  concurrency: 1,
  timeoutSeconds: 120,
  extraBody: '{"reasoning_effort": "none"}',
  effort: 'low',
  allowExternal: false,
  probe: null,
};

export async function loadAiSettings(db: Kysely<DB>): Promise<AiSettings> {
  return { ...DEFAULT_AI_SETTINGS, ...(await getSetting<Partial<AiSettings>>(db, 'ai', {})) };
}

export async function saveAiSettings(db: Kysely<DB>, settings: AiSettings): Promise<void> {
  await setSetting(db, 'ai', settings);
}

export function isExternal(settings: Pick<AiSettings, 'provider' | 'baseUrl'>): boolean {
  return isExternalAi(settings.provider, settings.baseUrl);
}

export function toView(settings: AiSettings, config: AppConfig): AiSettingsView {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: !!apiKey, externalBlocked: !config.allowExternalAi, isExternal: isExternal(settings) };
}

/**
 * 화면에서 받은 값을 저장할 설정으로. apiKey를 보내지 않으면 저장된 키를 그대로 쓰되,
 * 연결할 서버가 바뀌었으면 저장된 키를 버린다 (다른 서버로 키가 새 나가지 않게).
 */
export function fromInput(input: AiSettingsInput, current: AiSettings, probe: AiProbeResult | null): AiSettings {
  const { apiKey, ...rest } = input;
  const kept = sameAiTarget(input, current) ? current.apiKey : null;
  return {
    ...rest,
    apiKey: apiKey === undefined ? kept : apiKey.trim() || null,
    probe,
  };
}

/** 이 설정으로 이수증을 보내도 되는지. 안 되면 이유를 돌려준다 */
export function externalUseProblem(settings: AiSettings, config: AppConfig): string | null {
  if (!isExternal(settings)) return null;
  if (!config.allowExternalAi) return '이 설치본은 기관 밖(인터넷) AI를 쓸 수 없게 설정되어 있습니다 (config.json의 allowExternalAi).';
  if (!settings.allowExternal) {
    return "기관 밖(인터넷) AI 서버입니다. 이수증의 개인정보(성명·생년월일·소속)가 기관 밖으로 나갑니다. 쓰려면 '외부 AI 사용 허용'을 켜 주세요.";
  }
  return null;
}

/** 이미지를 AI에 보낼지: 직접 정했으면 그대로, '자동'이면 연결 테스트 결과로 */
export function useVision(settings: AiSettings): boolean {
  if (settings.vision === 'on') return true;
  if (settings.vision === 'off') return false;
  return settings.provider === 'anthropic' || settings.probe?.vision === true;
}
