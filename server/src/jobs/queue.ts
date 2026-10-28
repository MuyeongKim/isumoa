import type { FastifyBaseLogger } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';

// 쪽 처리 대기열. 대기열이 DB에 있어서 서버가 갑자기 꺼져도 다시 켜면 이어서 처리한다.
// 실패하면 10초, 1분 뒤에 다시 시도하고, 세 번째도 실패하면 "오류"로 남긴다.

const RETRY_DELAYS_SECONDS = [10, 60];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

export interface Job {
  id: number;
  kind: string;
  page_id: number;
  attempts: number;
  review_generation: number;
}

export async function enqueuePageJob(db: Kysely<DB>, pageId: number): Promise<void> {
  const page = await db.selectFrom('pages').select('review_generation').where('id', '=', pageId).executeTakeFirstOrThrow();
  await db.insertInto('jobs').values({ kind: 'process-page', page_id: pageId, review_generation: page.review_generation }).execute();
}

/** 서버 시작 때: 처리 도중 꺼져서 "처리 중"으로 남은 일을 다시 대기로 돌린다 */
export async function recoverInterruptedJobs(db: Kysely<DB>): Promise<number> {
  const result = await db.updateTable('jobs').set({ state: 'queued', updated_at: nowIso() }).where('state', '=', 'running').executeTakeFirst();
  await db.updateTable('pages').set({ state: 'queued' }).where('state', '=', 'processing').execute();
  return Number(result.numUpdatedRows);
}

/** 기다리는 일 하나를 "처리 중"으로 바꾸며 가져온다. SQLite는 문장 하나가 원자적이라 두 번 가져가지 않는다 */
export async function claimNextJob(db: Kysely<DB>): Promise<Job | undefined> {
  const now = nowIso();
  return db
    .updateTable('jobs')
    .set((eb) => ({ state: 'running', attempts: eb('attempts', '+', 1), updated_at: now }))
    .where('id', '=', (eb) =>
      eb.selectFrom('jobs').select('id').where('state', '=', 'queued').where('run_after', '<=', now).orderBy('id').limit(1),
    )
    .returning(['id', 'kind', 'page_id', 'attempts', 'review_generation'])
    .executeTakeFirst();
}

export async function finishJob(db: Kysely<DB>, jobId: number, expected?: Pick<Job, 'page_id' | 'review_generation'>): Promise<void> {
  await db.updateTable('jobs').set({ state: 'done', last_error: null, updated_at: nowIso() }).where('id', '=', jobId)
    .$if(expected !== undefined, query => query.where('page_id', '=', expected!.page_id).where('review_generation', '=', expected!.review_generation)).execute();
}

export async function failJob(db: Kysely<DB>, job: Job, message: string): Promise<'retry' | 'failed' | 'cancelled'> {
  if (job.attempts < MAX_ATTEMPTS) {
    const delay = RETRY_DELAYS_SECONDS[job.attempts - 1] ?? RETRY_DELAYS_SECONDS.at(-1)!;
    const updated = await db
      .updateTable('jobs')
      .set({ state: 'queued', last_error: message, run_after: new Date(Date.now() + delay * 1000).toISOString(), updated_at: nowIso() })
      .where('id', '=', job.id)
      .where('page_id', '=', job.page_id).where('review_generation', '=', job.review_generation)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) return 'cancelled';
    await db.updateTable('pages').set({ state: 'queued' }).where('id', '=', job.page_id).where('review_generation', '=', job.review_generation).execute();
    return 'retry';
  }
  const updated = await db.updateTable('jobs').set({ state: 'failed', last_error: message, updated_at: nowIso() }).where('id', '=', job.id)
    .where('page_id', '=', job.page_id).where('review_generation', '=', job.review_generation).executeTakeFirst();
  if (Number(updated.numUpdatedRows) === 0) return 'cancelled';
  await db.updateTable('pages').set({ state: 'error', error: message }).where('id', '=', job.page_id).where('review_generation', '=', job.review_generation).execute();
  return 'failed';
}

export interface Worker {
  /** 새 일이 들어왔을 때 기다리지 말고 바로 처리하게 깨운다 */
  notify(): void;
  /** 최근 처리한 쪽의 평균 시간(밀리초) */
  averageMs(): number | null;
  /** 동시에 처리하는 쪽 수 */
  concurrency(): number;
  /** AI 서버가 여러 요청을 함께 받을 수 있으면 늘린다 (설정 화면에서 바꾸면 바로 반영) */
  setConcurrency(n: number): void;
  stop(): Promise<void>;
}

export function startWorker(options: {
  db: Kysely<DB>;
  handle: (job: Job) => Promise<void>;
  log: FastifyBaseLogger;
  pollMs?: number;
  concurrency?: number;
}): Worker {
  const { db, handle, log, pollMs = 2000 } = options;
  const durations: number[] = [];
  const sleepers = new Set<() => void>();
  const loops: Promise<void>[] = [];
  let stopped = false;
  let target = Math.max(1, options.concurrency ?? 1);
  let running = 0;

  const sleep = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, pollMs);
      sleepers.add(done);
    });
  const wakeAll = () => {
    for (const wake of [...sleepers]) wake();
  };

  async function loop() {
    while (!stopped) {
      if (running > target) break; // 동시 처리 수를 줄였으면 남는 일꾼은 끝낸다
      let job: Job | undefined;
      try {
        job = await claimNextJob(db);
      } catch (err) {
        log.error(err, '대기열을 읽지 못했습니다');
      }
      if (!job) {
        await sleep();
        continue;
      }
      const started = Date.now();
      try {
        await handle(job);
        await finishJob(db, job.id, job);
        durations.push(Date.now() - started);
        if (durations.length > 30) durations.shift();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const outcome = await failJob(db, job, message);
        log.warn({ jobId: job.id, pageId: job.page_id, attempts: job.attempts, outcome }, `쪽 처리 실패: ${message}`);
      }
    }
    running--;
  }

  const spawn = () => {
    while (!stopped && running < target) {
      running++;
      loops.push(loop());
    }
  };
  spawn();

  return {
    notify: wakeAll,
    averageMs: () => (durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null),
    concurrency: () => target,
    setConcurrency(n) {
      target = Math.max(1, Math.min(8, Math.round(n)));
      spawn();
      wakeAll();
    },
    async stop() {
      stopped = true;
      wakeAll();
      await Promise.all(loops);
    },
  };
}
