import { rm } from 'node:fs/promises';
import { sql, type Kysely } from 'kysely';
import type { PurgeCandidate, RetentionSettings } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { originalPath, pagesDir } from '../storage.ts';

// 보관기간과 파기.
//  - 이수증 자료(원본·쪽 이미지·읽은 글자·이수 기록): 보관기간이 지난 "대상 연도"를 관리자가 확인하고 파기한다.
//    기산일은 기록물 관례대로 다음 해 1월 1일 (보관 5년이면 2021년 자료는 2027년부터 파기 대상)
//  - 접속기록·감사 로그: 보관기간이 지나면 서버가 매일 스스로 지운다
//    (접속기록은 최소 2년, 계정·권한 변경 이력이 든 감사 로그는 최소 3년 — 개인정보 안전성 확보조치 기준보다 길게)

export const DEFAULT_RETENTION: RetentionSettings = { documentYears: 5, accessLogYears: 2, auditLogYears: 3, backupKeep: 30 };
export const RETENTION_MIN: RetentionSettings = { documentYears: 1, accessLogYears: 2, auditLogYears: 3, backupKeep: 3 };

export async function loadRetention(db: Kysely<DB>): Promise<RetentionSettings> {
  return { ...DEFAULT_RETENTION, ...(await getSetting<Partial<RetentionSettings>>(db, 'retention', {})) };
}

export async function saveRetention(db: Kysely<DB>, settings: RetentionSettings): Promise<void> {
  await setSetting(db, 'retention', settings);
}

export function seoulYear(now = new Date()): number {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(now));
}

/** 오늘로부터 years년 전 (UTC ISO) */
function yearsAgo(years: number, now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString();
}

/** 보관기간이 지난 접속기록·감사 로그를 지운다 */
export async function pruneLogs(db: Kysely<DB>, settings: RetentionSettings, now = new Date()): Promise<{ access: number; audit: number }> {
  const access = await db.deleteFrom('access_log').where('at', '<', yearsAgo(Math.max(settings.accessLogYears, RETENTION_MIN.accessLogYears), now)).executeTakeFirst();
  const audit = await db.deleteFrom('audit_log').where('at', '<', yearsAgo(Math.max(settings.auditLogYears, RETENTION_MIN.auditLogYears), now)).executeTakeFirst();
  // 다 끝난 처리 대기열 기록은 한 달만 둔다
  await db.deleteFrom('jobs').where('state', '=', 'done').where('updated_at', '<', new Date(now.getTime() - 30 * 86_400_000).toISOString()).execute();
  return { access: Number(access.numDeletedRows), audit: Number(audit.numDeletedRows) };
}

/** 이 연도의 자료를 파기할 수 있는 첫해 */
export function purgeableFrom(year: number, settings: RetentionSettings): number {
  return year + settings.documentYears + 1;
}

async function describeYear(db: Kysely<DB>, year: number): Promise<PurgeCandidate> {
  const count = async (q: Promise<{ n: number | string | bigint } | undefined>) => Number((await q)?.n ?? 0);
  const batchIds = db.selectFrom('batches').select('id').where('year', '=', year);
  const fileIds = db.selectFrom('files').select('id').where('batch_id', 'in', batchIds);
  const sizes = await db
    .selectFrom('files')
    .select((eb) => [eb.fn.countAll<number>().as('n'), eb.fn.coalesce(eb.fn.sum<number>('size'), sql<number>`0`).as('bytes')])
    .where('batch_id', 'in', batchIds)
    .executeTakeFirstOrThrow();
  return {
    year,
    batches: await count(db.selectFrom('batches').select((eb) => eb.fn.countAll<number>().as('n')).where('year', '=', year).executeTakeFirst()),
    files: Number(sizes.n),
    bytes: Number(sizes.bytes),
    pages: await count(db.selectFrom('pages').select((eb) => eb.fn.countAll<number>().as('n')).where('file_id', 'in', fileIds).executeTakeFirst()),
    certificates: await count(
      db.selectFrom('certificates').select((eb) => eb.fn.countAll<number>().as('n')).where('batch_id', 'in', batchIds).executeTakeFirst(),
    ),
    exemptions: await count(db.selectFrom('exemptions').select((eb) => eb.fn.countAll<number>().as('n')).where('year', '=', year).executeTakeFirst()),
    retiredEmployees: (await retiredToRemove(db, year)).length,
  };
}

/** 이 연도 말까지 퇴직했고, 파기 뒤 남는 이수 기록이 없는 직원 (개인정보를 더 둘 이유가 없음) */
async function retiredToRemove(db: Kysely<DB>, year: number): Promise<number[]> {
  const rows = await db
    .selectFrom('employees as e')
    .select('e.id')
    .where('e.status', '=', 'retired')
    .where('e.left_on', 'is not', null)
    .where('e.left_on', '<=', `${year}-12-31`)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('certificates as c')
            .innerJoin('batches as b', 'b.id', 'c.batch_id')
            .select('c.id')
            .whereRef('c.employee_id', '=', 'e.id')
            .where('b.year', '!=', year),
        ),
      ),
    )
    .execute();
  return rows.map((r) => r.id);
}

/** 파기할 수 있는 연도 목록 (자료가 남아 있는 연도만) */
export async function purgeCandidates(db: Kysely<DB>, settings: RetentionSettings, now = new Date()): Promise<PurgeCandidate[]> {
  const thisYear = seoulYear(now);
  const years = await db
    .selectFrom('batches')
    .select('year')
    .distinct()
    .union(db.selectFrom('exemptions').select('year').distinct())
    .execute();
  const due = years.map((y) => y.year).filter((y) => purgeableFrom(y, settings) <= thisYear);
  return Promise.all(due.sort((a, b) => a - b).map((y) => describeYear(db, y)));
}

export interface PurgeResult extends PurgeCandidate {
  /** 지우지 못한 파일 (권한 문제 등) */
  fileErrors: number;
}

/** 한 연도의 이수증 자료를 DB와 디스크에서 지운다 (되돌릴 수 없음 — 부르기 전에 확인을 받는다) */
export async function purgeYear(db: Kysely<DB>, dataDir: string, year: number): Promise<PurgeResult> {
  const summary = await describeYear(db, year);
  const files = await db
    .selectFrom('files')
    .innerJoin('batches', 'batches.id', 'files.batch_id')
    .select(['files.id', 'files.stored_name'])
    .where('batches.year', '=', year)
    .execute();
  const retired = await retiredToRemove(db, year);

  await db.transaction().execute(async (trx) => {
    // 묶음을 지우면 파일·쪽·이수증·인정 교육·처리 대기열이 함께 지워진다 (ON DELETE CASCADE)
    await trx.deleteFrom('batches').where('year', '=', year).execute();
    await trx.deleteFrom('exemptions').where('year', '=', year).execute();
    // 다른 해의 이수증이 없는 퇴직자만 고른 것이라 이 연도 이수증을 지운 뒤에는 연결이 남지 않는다
    if (retired.length > 0) await trx.deleteFrom('employees').where('id', 'in', retired).execute();
  });

  let fileErrors = 0;
  for (const f of files) {
    try {
      await rm(originalPath(dataDir, f.stored_name), { force: true });
      await rm(pagesDir(dataDir, f.id), { recursive: true, force: true });
    } catch {
      fileErrors++;
    }
  }
  return { ...summary, fileErrors };
}
