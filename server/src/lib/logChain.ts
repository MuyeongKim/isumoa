import { createHash } from 'node:crypto';
import type { Insertable, Kysely } from 'kysely';
import type { AccessLogTable, AuditLogTable, DB } from '../db/schema.ts';

// 감사 로그·접속기록의 위·변조 확인.
// 기록마다 "앞 기록의 hash + 이 기록 내용"으로 SHA-256을 계산해 함께 저장한다(해시 체인).
// 누군가 DB에서 중간 기록을 고치거나 지우면 그 뒤로 이어짐이 끊겨 "무결성 확인"에서 드러난다.
// 이 서버 프로세스만 기록을 쓰므로 마지막 hash를 메모리에 두고 한 번에 하나씩 붙인다.

export const GENESIS = '0'.repeat(64);

type AuditRow = Omit<Insertable<AuditLogTable>, 'id' | 'prev_hash' | 'hash'> & { at: string };
type AccessRow = Omit<Insertable<AccessLogTable>, 'id' | 'prev_hash' | 'hash'>;

export function chainHash(prev: string, fields: unknown[]): string {
  return createHash('sha256').update(prev).update('\n').update(JSON.stringify(fields)).digest('hex');
}

const FIELDS = {
  audit_log: (r: { at: string | null | undefined; user_id?: number | null; user_login?: string | null; action: string; target_type?: string | null; target_id?: string | null; detail?: string | null; ip?: string | null }) => [
    r.at ?? null,
    r.user_id ?? null,
    r.user_login ?? null,
    r.action,
    r.target_type ?? null,
    r.target_id ?? null,
    r.detail ?? null,
    r.ip ?? null,
  ],
  access_log: (r: { at: string; user_id?: number | null; user_login?: string | null; method: string; path: string; status: number; ip?: string | null; ms?: number | null }) => [
    r.at,
    r.user_id ?? null,
    r.user_login ?? null,
    r.method,
    r.path,
    r.status,
    r.ip ?? null,
    r.ms ?? null,
  ],
};

type Table = keyof typeof FIELDS;

interface ChainState {
  tail: Promise<unknown>;
  last: string | null;
}
const states = new WeakMap<Kysely<DB>, Record<Table, ChainState>>();

function stateOf(db: Kysely<DB>, table: Table): ChainState {
  let s = states.get(db);
  if (!s) {
    s = { audit_log: { tail: Promise.resolve(), last: null }, access_log: { tail: Promise.resolve(), last: null } };
    states.set(db, s);
  }
  return s[table];
}

async function lastHash(db: Kysely<DB>, table: Table): Promise<string> {
  const row = await db.selectFrom(table).select('hash').where('hash', 'is not', null).orderBy('id', 'desc').limit(1).executeTakeFirst();
  return row?.hash ?? GENESIS;
}

/** 한 번에 하나씩 이어 붙인다 (실패한 기록은 건너뛰고 다음 기록은 계속 받는다) */
function append(db: Kysely<DB>, table: Table, fields: unknown[], insert: (prev: string, hash: string) => Promise<unknown>): Promise<void> {
  const state = stateOf(db, table);
  const run = state.tail.then(async () => {
    const prev = state.last ?? (await lastHash(db, table));
    const hash = chainHash(prev, fields);
    await insert(prev, hash);
    state.last = hash;
  });
  state.tail = run.catch(() => undefined);
  return run;
}

export function appendAudit(db: Kysely<DB>, row: AuditRow): Promise<void> {
  return append(db, 'audit_log', FIELDS.audit_log(row), (prev_hash, hash) =>
    db.insertInto('audit_log').values({ ...row, prev_hash, hash }).execute(),
  );
}

export function appendAccess(db: Kysely<DB>, row: AccessRow): Promise<void> {
  return append(db, 'access_log', FIELDS.access_log(row), (prev_hash, hash) =>
    db.insertInto('access_log').values({ ...row, prev_hash, hash }).execute(),
  );
}

/**
 * 이 기능 이전에 남은 감사 로그에 hash를 채운다. 서버가 새 기록을 쓰기 전에 한 번 부른다.
 * 채운 개수를 돌려준다.
 */
export async function sealAuditLog(db: Kysely<DB>): Promise<number> {
  const rows = await db.selectFrom('audit_log').selectAll().where('hash', 'is', null).orderBy('id').execute();
  if (rows.length === 0) return 0;
  const before = await db.selectFrom('audit_log').select('hash').where('id', '<', rows[0].id).where('hash', 'is not', null).orderBy('id', 'desc').limit(1).executeTakeFirst();
  let prev = before?.hash ?? GENESIS;
  await db.transaction().execute(async (trx) => {
    for (const r of rows) {
      const hash = chainHash(prev, FIELDS.audit_log(r));
      await trx.updateTable('audit_log').set({ prev_hash: prev, hash }).where('id', '=', r.id).execute();
      prev = hash;
    }
  });
  stateOf(db, 'audit_log').last = null; // 다음 기록은 DB에서 마지막 값을 다시 읽는다
  return rows.length;
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  firstId: number | null;
  lastId: number | null;
  /** 앞부분이 보관기간이 지나 지워졌는지 (첫 기록이 처음 기록이 아님) */
  trimmed: boolean;
  brokenAt: number | null;
  problem: string | null;
}

/** 처음부터 끝까지 hash를 다시 계산해 이어짐을 확인한다 */
export async function verifyChain(db: Kysely<DB>, table: Table): Promise<ChainCheck> {
  const result: ChainCheck = { ok: true, checked: 0, firstId: null, lastId: null, trimmed: false, brokenAt: null, problem: null };
  let expectedPrev: string | null = null;
  let afterId = 0;
  for (;;) {
    const rows: Record<string, unknown>[] =
      table === 'audit_log'
        ? await db.selectFrom('audit_log').selectAll().where('id', '>', afterId).orderBy('id').limit(5000).execute()
        : await db.selectFrom('access_log').selectAll().where('id', '>', afterId).orderBy('id').limit(5000).execute();
    if (rows.length === 0) break;
    for (const r of rows) {
      const id = r.id as number;
      result.firstId ??= id;
      result.lastId = id;
      result.checked++;
      afterId = id;
      const prev = r.prev_hash as string | null;
      const fields = table === 'audit_log' ? FIELDS.audit_log(r as never) : FIELDS.access_log(r as never);
      const fail = (problem: string) => Object.assign(result, { ok: false, brokenAt: id, problem });
      if (prev === null || r.hash === null) {
        fail('hash가 없는 기록이 있습니다.');
        return result;
      }
      if (expectedPrev === null) {
        result.trimmed = prev !== GENESIS;
      } else if (prev !== expectedPrev) {
        fail('앞 기록과 이어지지 않습니다 (중간 기록이 지워졌거나 바뀜).');
        return result;
      }
      if (chainHash(prev, fields) !== r.hash) {
        fail('기록 내용이 저장할 때와 다릅니다 (내용이 바뀜).');
        return result;
      }
      expectedPrev = r.hash as string;
    }
  }
  return result;
}
