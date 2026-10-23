import { describe, expect, it } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate.ts';
import { openDatabase } from '../../server/src/db/sqlite.ts';
import { appendAccess, appendAudit, sealAuditLog, verifyChain } from '../../server/src/lib/logChain.ts';
import { maskRrn } from '../../server/src/lib/privacy.ts';

describe('주민등록번호 가리기', () => {
  it('뒷자리를 가리고 생년월일·성별 자리는 남긴다', () => {
    expect(maskRrn('주민등록번호 : 850312-1234567')).toBe('주민등록번호 : 850312-1******');
    expect(maskRrn('850312 - 2234567 / 041231-3123456')).toBe('850312-2****** / 041231-3******');
  });

  it('이수번호·전화번호·날짜는 건드리지 않는다', () => {
    for (const text of ['이수번호 2026-0417', '010-1234-5678', '2026-03-31', '851332-1234567', '850312-9234567', '1850312-1234567']) {
      expect(maskRrn(text)).toBe(text);
    }
  });
});

describe('기록 위·변조 확인 (해시 체인)', () => {
  async function freshDb() {
    const { raw, db } = openDatabase(':memory:');
    runMigrations(raw);
    return { raw, db };
  }
  const row = (n: number) => ({
    at: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
    user_id: 1,
    user_login: 'admin',
    action: 'login',
    target_type: null,
    target_id: null,
    detail: JSON.stringify({ n }),
    ip: '127.0.0.1',
  });

  it('차례로 붙인 기록은 정상, 내용을 고치거나 중간을 지우면 그 자리를 알려 준다', async () => {
    const { db } = await freshDb();
    for (let i = 1; i <= 5; i++) await appendAudit(db, row(i));
    expect(await verifyChain(db, 'audit_log')).toMatchObject({ ok: true, checked: 5, trimmed: false });

    await db.updateTable('audit_log').set({ detail: '{"n":99}' }).where('id', '=', 3).execute();
    expect(await verifyChain(db, 'audit_log')).toMatchObject({ ok: false, brokenAt: 3 });
    await db.updateTable('audit_log').set({ detail: '{"n":3}' }).where('id', '=', 3).execute();

    await db.deleteFrom('audit_log').where('id', '=', 4).execute();
    expect(await verifyChain(db, 'audit_log')).toMatchObject({ ok: false, brokenAt: 5 });
  });

  it('보관기간이 지나 앞부분을 지운 것은 정상으로 본다', async () => {
    const { db } = await freshDb();
    for (let i = 1; i <= 4; i++) {
      await appendAccess(db, { at: row(i).at, user_id: 1, user_login: 'admin', method: 'GET', path: `/api/x?${i}`, status: 200, ip: null, ms: 3 });
    }
    await db.deleteFrom('access_log').where('id', '<=', 2).execute();
    expect(await verifyChain(db, 'access_log')).toMatchObject({ ok: true, checked: 2, trimmed: true });
  });

  it('이 기능 전에 남은 감사 로그에도 hash를 채우고 이어 붙인다', async () => {
    const { db } = await freshDb();
    await db.insertInto('audit_log').values([row(1), row(2)]).execute();
    expect(await sealAuditLog(db)).toBe(2);
    await appendAudit(db, row(3));
    expect(await verifyChain(db, 'audit_log')).toMatchObject({ ok: true, checked: 3 });
    expect(await sealAuditLog(db)).toBe(0);
  });
});
