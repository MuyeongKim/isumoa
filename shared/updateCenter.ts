import type { OfficialRuleEnvelope } from './reviewTools.ts';
import type { UpdateRelease, UpdateStatus } from './updateChannel.ts';
export type UpdateTarget = 'all' | 'program' | 'rules';
export type UpdateCheckState = 'unchecked' | 'checking' | 'current' | 'available' | 'requires_program' | 'error';
export interface UpdatePreferences { autoEnabled: boolean }
export interface UpdateChannelCheck<T> {
  state: UpdateCheckState;
  attemptedAt: string | null;
  succeededAt: string | null;
  error: string | null;
  latest: T | null;
}
export interface RuleUpdateInfo { version: string; name: string; minimumAppVersion: string; count: number }
export interface UpdateCenterStatus {
  preferences: UpdatePreferences;
  lastAutomaticDay: string | null;
  checking: boolean;
  program: UpdateChannelCheck<UpdateRelease> & { currentVersion: string; installer: UpdateStatus };
  rules: UpdateChannelCheck<RuleUpdateInfo> & { currentVersion: string; customVersion: string; customCount: number };
  availableCount: number;
  hasCheckError: boolean;
}
export interface CachedUpdateCheck<T> {
  attemptedAt: string | null;
  succeededAt: string | null;
  error: string | null;
  latest: T | null;
  pending?: boolean;
}
export interface UpdateCheckCache {
  program: CachedUpdateCheck<UpdateRelease>;
  rules: CachedUpdateCheck<OfficialRuleEnvelope>;
}
