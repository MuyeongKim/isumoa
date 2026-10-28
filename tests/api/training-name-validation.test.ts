import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(async () => { h = await createHarness(); });
afterEach(async () => { await h.close(); });
const create = (name: string) => h.send('POST', '/api/trainings', { name, reqType: 'hours', reqValue: 2, keywords: ['청렴'] });

describe('교육 이름 중복과 소수 시간 기준', () => {
  it('기본 활성 교육과 이름이 같은 직접 추가를 거절해 교육 수·기준을 보존한다', async () => {
    const before = await h.db.selectFrom('trainings').selectAll().orderBy('id').execute();
    const response = await create('청렴 교육(부패방지교육)');
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('이미 있습니다');
    expect(await h.db.selectFrom('trainings').selectAll().orderBy('id').execute()).toEqual(before);
  });

  it('공백·영문 대소문자·한글 조합 형태가 다른 이름도 중복으로 판단한다', async () => {
    expect((await create('AI 청렴교육')).statusCode).toBe(200);
    expect((await create(` ai   ${'청렴교육'.normalize('NFD')} `)).statusCode).toBe(409);
    expect((await h.send('GET', '/api/trainings')).json().filter((t: { name: string }) => t.name.startsWith('AI '))).toHaveLength(1);
  });

  it('다른 교육·휴지통 교육의 이름으로 변경하려 하면 원래 설정을 그대로 둔다', async () => {
    const id = (await create('이름 변경 대상')).json().id;
    const otherId = (await create('별도 교육')).json().id;
    const before = await h.db.selectFrom('trainings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    const active = await h.send('PATCH', `/api/trainings/${id}`, { name: '별도 교육', reqValue: 3, note: '저장되면 안 됨' });
    expect(active.statusCode).toBe(409);
    expect(await h.db.selectFrom('trainings').selectAll().where('id', '=', id).executeTakeFirst()).toEqual(before);
    await h.send('DELETE', `/api/trainings/${otherId}`);
    const trashed = await h.send('PATCH', `/api/trainings/${id}`, { name: '별 도 교 육' });
    expect(trashed.statusCode).toBe(409);
    expect(trashed.json().error.message).toContain('휴지통');
    expect(await h.db.selectFrom('trainings').selectAll().where('id', '=', id).executeTakeFirst()).toEqual(before);
  });

  it('동시에 같은 이름을 추가해도 하나만 생성한다', async () => {
    const responses = await Promise.all([create('동시 등록 교육'), create('동시등록교육')]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    const all = await h.db.selectFrom('trainings').select('name').execute();
    expect(all.filter(t => t.name.replace(/\s/g, '') === '동시등록교육')).toHaveLength(1);
  });

  it('과거 중복 이름은 자동 수정하지 않고 이름을 바꾸지 않는 메모 수정은 허용한다', async () => {
    const id = (await create('과거 교육')).json().id;
    const original = await h.db.selectFrom('trainings').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
    // 이전 버전에서 이미 생긴 중복 자료를 가상 DB에 재현한다.
    const duplicate = await h.db.insertInto('trainings').values({ code: 'legacy-duplicate', name: original.name, req_type: 'hours', req_value: 2 }).returningAll().executeTakeFirstOrThrow();
    expect((await h.send('PATCH', `/api/trainings/${id}`, { name: original.name, note: '메모 보완' })).statusCode).toBe(200);
    expect((await h.db.selectFrom('trainings').select('note').where('id', '=', id).executeTakeFirst())?.note).toBe('메모 보완');
    expect(await h.db.selectFrom('trainings').selectAll().where('id', '=', duplicate.id).executeTakeFirst()).toEqual(duplicate);
  });

  it('문서로 가져온 15분·45분 기준은 값을 유지하면서 수정 저장할 수 있다', async () => {
    const response = await h.send('POST', '/api/trainings/import/apply', { fileName: '분 단위 기준표.hwpx', trainings: [
      { name: '15분 기준 교육', reqType: 'hours', reqValue: 0.25 },
      { name: '45분 기준 교육', reqType: 'hours', reqValue: 0.75 },
    ] });
    expect(response.statusCode).toBe(200);
    for (const [index, id] of (response.json().ids as number[]).entries()) {
      const reqValue = index === 0 ? 0.25 : 0.75;
      expect((await h.send('PATCH', `/api/trainings/${id}`, { reqType: 'hours', reqValue, note: '시간 기준을 유지한 메모 수정' })).statusCode).toBe(200);
      expect((await h.db.selectFrom('trainings').select('req_value').where('id', '=', id).executeTakeFirst())?.req_value).toBe(reqValue);
    }
  });
});
