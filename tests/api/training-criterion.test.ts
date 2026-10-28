import { describe, it, expect } from 'vitest';
import { createHarness } from './harness.ts';
describe('교육 횟수와 시간 기준', () => {
  it('소수 횟수 생성·단위 변경·문서 등록을 거부하고 소수 시간은 유지한다', async () => {
    const h = await createHarness();
    try {
      const invalid = await h.send('POST', '/api/trainings', { name: '검증 횟수', reqType: 'count', reqValue: .5 });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.message).toContain('정수');
      const valid = await h.send('POST', '/api/trainings', { name: '검증 시간', reqType: 'hours', reqValue: .25 });
      expect(valid.statusCode).toBe(200);
      const id = valid.json().id;
      expect((await h.send('PATCH', `/api/trainings/${id}`, { reqType: 'count' })).statusCode).toBe(400);
      expect((await h.send('PATCH', `/api/trainings/${id}`, { reqType: 'count', reqValue: 2 })).statusCode).toBe(200);
      expect((await h.send('PATCH', `/api/trainings/${id}`, { reqValue: 1.5 })).statusCode).toBe(400);
      const imported = await h.send('POST', '/api/trainings/import/apply', { fileName: 'test.pdf', trainings: [{ name: '가상 잘못된 횟수', reqType: 'count', reqValue: .5 }] });
      expect(imported.statusCode).toBe(400);
      const rows = (await h.send('GET', '/api/trainings')).json();
      expect(rows.find((t: { id: number }) => t.id === id).reqValue).toBe(2);
      expect(rows.some((t: { name: string }) => t.name === '가상 잘못된 횟수')).toBe(false);
    } finally { await h.close(); }
  });
});
