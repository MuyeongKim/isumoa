import { ZodError } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { systemAudit } from '../lib/audit.ts';
import { compareVersions as compareAppVersions } from '../../../shared/updateChannel.ts';
import { canonical, compareVersions as compareRuleVersions } from '../rules/schema.ts';
import { fetchOfficialRules, loadRuleState, previewRules, verifyOfficial } from '../rules/service.ts';
import type { OfficialRuleEnvelope } from '../../../shared/reviewTools.ts';
import type { CachedUpdateCheck, UpdateCheckCache, UpdateCenterStatus, UpdatePreferences, UpdateTarget, UpdateCheckState } from '../../../shared/updateCenter.ts';
import type { createUpdateService } from './service.ts';

const PREF = 'updateCheckPreferences', CACHE = 'updateCheckCache', AUTO_DAY = 'updateAutomaticDay';
const empty = <T>(): CachedUpdateCheck<T> => ({ attemptedAt: null, succeededAt: null, error: null, latest: null });
const defaults: UpdatePreferences = { autoEnabled: false };
const day = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const failure = (e: unknown) => e instanceof HttpError ? e.message : e instanceof ZodError ? '공식 규칙 파일 형식이 지원되지 않습니다. 프로그램 업데이트를 확인한 뒤 다시 시도하세요.' : '배포 정보를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인하세요.';
const enabled = (value: unknown) => !!value && typeof value === 'object' && 'autoEnabled' in value && value.autoEnabled === true;

export function createUpdateCenter({ db, version, updates, ruleFetcher, now = () => new Date() }: {
  db: Kysely<DB>; version: string; updates: ReturnType<typeof createUpdateService>;
  ruleFetcher?: () => Promise<{ envelope: unknown; available: boolean }>;
  now?: () => Date;
}) {
  const active = new Set<'program' | 'rules'>();
  let checking = false, stopped = false;
  let first: ReturnType<typeof setTimeout> | undefined, timer: ReturnType<typeof setInterval> | undefined;
  const preferences = async ():Promise<UpdatePreferences> => ({autoEnabled:enabled(await getSetting<unknown>(db,PREF,defaults))});
  const cache = () => getSetting<UpdateCheckCache>(db, CACHE, { program: empty(), rules: empty() });
  async function saveChannel<K extends keyof UpdateCheckCache>(channel: K, value: UpdateCheckCache[K]) {
    if (stopped) return;
    await db.transaction().execute(async trx => {
      const current = await getSetting<UpdateCheckCache>(trx, CACHE, { program: empty(), rules: empty() });
      await setSetting(trx, CACHE, { ...current, [channel]: value });
    });
  }
  function statusOf<T>(channel: 'program' | 'rules', entry: CachedUpdateCheck<T>, compare: () => UpdateCheckState): UpdateCheckState {
    if (active.has(channel)) return 'checking';
    if (entry.pending || entry.error) return 'error';
    return entry.latest ? compare() : 'unchecked';
  }
  async function status(): Promise<UpdateCenterStatus> {
    const [c, prefs, lastAutomaticDay, rules] = await Promise.all([cache(), preferences(), getSetting<string | null>(db, AUTO_DAY, null), loadRuleState(db)]);
    const programState = statusOf('program', c.program, () => compareAppVersions(c.program.latest!.version, version) > 0 ? 'available' : 'current');
    const rulesState = statusOf('rules', c.rules, () => {
      const p = c.rules.latest!.pack;
      if (compareAppVersions(p.minimumAppVersion, version) > 0) return 'requires_program';
      return compareRuleVersions(p.version, rules.official.version) > 0 ? 'available' : 'current';
    });
    const err = (channel:'program'|'rules',e: CachedUpdateCheck<unknown>) => active.has(channel) ? null : e.pending ? '이전 버전 확인이 끝나지 않았습니다. 다시 확인해 주세요.' : e.error;
    const p = c.rules.latest?.pack;
    return {
      preferences: prefs, lastAutomaticDay, checking,
      program: { ...c.program, error: err('program',c.program), state: programState, currentVersion: version, installer: updates.status() },
      rules: { ...c.rules, latest: p ? { version: p.version, name: p.name, minimumAppVersion: p.minimumAppVersion, count: p.rules.length } : null,
        error: err('rules',c.rules), state: rulesState, currentVersion: rules.official.version, customVersion: rules.custom.version, customCount: rules.custom.rules.length },
      availableCount: Number(programState === 'available') + Number(rulesState === 'available' || rulesState === 'requires_program'),
      hasCheckError: programState === 'error' || rulesState === 'error',
    };
  }
  async function checkChannel(channel: 'program' | 'rules') {
    const previous = (await cache())[channel], attemptedAt = now().toISOString();
    await saveChannel(channel, { ...previous, attemptedAt, pending: true, error: null } as never);
    try {
      if (channel === 'program') {
        const result = await updates.check();
        if (result.phase === 'error' || !result.latest) throw badRequest(result.error && /[가-힣]/.test(result.error) ? result.error : '프로그램 배포 정보를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 확인하세요.');
        await saveChannel('program', { latest: result.latest, attemptedAt, succeededAt: now().toISOString(), error: null });
      } else {
        const value = ruleFetcher ? (await ruleFetcher()).envelope : await fetchOfficialRules({ allowIncompatible: true });
        const envelope = verifyOfficial(value, { allowIncompatible: true });
        const current = await loadRuleState(db);
        if(envelope.pack.version===current.official.version&&canonical(envelope.pack)!==canonical(current.official))throw badRequest('같은 공식 규칙 버전의 내용이 다릅니다. 현재 규칙을 유지합니다.');
        if (compareRuleVersions(envelope.pack.version, current.official.version) < 0) throw badRequest('배포 규칙이 현재 공식 규칙보다 이전 버전입니다. 현재 규칙을 유지하고 나중에 다시 확인하세요.');
        await saveChannel('rules', { latest: envelope, attemptedAt, succeededAt: now().toISOString(), error: null });
      }
    } catch (e) {
      await saveChannel(channel, { ...previous, attemptedAt, pending: false, error: failure(e) } as never);
    } finally { active.delete(channel); }
  }
  async function check(target: UpdateTarget = 'all', automatic = false): Promise<UpdateCenterStatus> {
    const phase = updates.status().phase;
    if (checking || ['checking', 'downloading', 'installing'].includes(phase) || (automatic && phase === 'ready')) {
      if (automatic) return status();
      throw new HttpError(409, '다른 버전 확인 또는 프로그램 업데이트가 진행 중입니다. 끝난 뒤 다시 확인하세요.');
    }
    checking = true;
    try {
      if (automatic) {
        const claimed = await db.transaction().execute(async trx => {
          const prefs = await getSetting<UpdatePreferences>(trx, PREF, defaults), today = day(now());
          const last = await getSetting<string>(trx, AUTO_DAY, '');
          if (!enabled(prefs) || last >= today) return false;
          await setSetting(trx, AUTO_DAY, today);
          return true;
        });
        if (!claimed) return status();
      }
      const targets = target === 'all' ? ['program', 'rules'] as const : [target];
      for (const channel of targets) active.add(channel);
      await Promise.all(targets.map(channel => checkChannel(channel)));
      if (automatic && !stopped) await systemAudit(db, 'updates.check', { source: 'automatic', target, day: day(now()) });
    } finally { checking = false; active.clear(); }
    return status();
  }
  async function setPreferences(next: UpdatePreferences) {
    await setSetting(db, PREF, next);
    return status();
  }
  async function rulesPreview() {
    const current = await status();
    if (current.rules.state === 'requires_program') throw badRequest(`공식 규칙은 프로그램 ${current.rules.latest!.minimumAppVersion} 이상이 필요합니다. 프로그램을 먼저 업데이트하세요.`);
    if (current.rules.state !== 'available') throw badRequest('먼저 공식 규칙의 새 버전이 있는지 확인하세요.');
    const envelope = verifyOfficial((await cache()).rules.latest);
    return { envelope, preview: await previewRules(db, envelope, 'official') };
  }
  async function downloadProgram() {
    if(!updates.status().supported)throw badRequest('업데이트 다운로드·설치는 Windows PC 설치판에서 사용할 수 있습니다.');
    if (checking) throw new HttpError(409, '버전 확인이 끝난 뒤 업데이트를 받아 주세요.');
    await check('program');
    if ((await status()).program.state !== 'available') throw badRequest('다운로드할 새 프로그램 버전을 확인하지 못했습니다. 확인 결과를 살펴보고 다시 시도하세요.');
    updates.download();
    return status();
  }
  function start() {
    stopped = false;
    const tick = () => { if (!stopped) void check('all', true).catch(() => undefined); };
    first = setTimeout(tick, 30_000); first.unref();
    timer = setInterval(tick, 5 * 60_000); timer.unref();
  }
  function stop() { stopped = true; clearTimeout(first); clearInterval(timer); }
  return { status, check, setPreferences, rulesPreview, downloadProgram, start, stop };
}
