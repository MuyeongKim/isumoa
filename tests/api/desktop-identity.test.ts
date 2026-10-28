import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHarness } from './harness.ts';

describe('PC 실행본 확인', () => {
  it('제품 식별과 현재 열쇠에 묶인 일회 확인 응답을 주며 열쇠는 노출하지 않는다', async () => {
    const token = 'a'.repeat(48), challenge = 'b'.repeat(64);
    const pc = await createHarness({ desktop: true }, { shutdownToken: token });
    try {
      const response = await pc.app.inject({ method: 'GET', url: `/api/health?challenge=${challenge}` });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toEqual({ ok: true, application: 'isumoa', protocol: 1, version: 'test',
        proof: createHmac('sha256', token).update(`isumoa-instance-v1:${challenge}`).digest('hex') });
      expect(response.body).not.toContain(token);
      const other = (await pc.app.inject({ method: 'GET', url: `/api/health?challenge=${'c'.repeat(64)}` })).json();
      expect(other.proof).not.toBe(response.json().proof);
      expect((await pc.app.inject({ method: 'GET', url: '/api/health' })).json()).not.toHaveProperty('proof');
    } finally { await pc.close(); }
  });

  it('서버판은 PC 실행본의 확인 증명을 제공하지 않는다', async () => {
    const server = await createHarness({}, { shutdownToken: 'a'.repeat(48) });
    try {
      const response = await server.app.inject({ method: 'GET', url: `/api/health?challenge=${'b'.repeat(64)}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty('proof');
    } finally { await server.close(); }
  });

  it('비정상·과도한 확인 난수는 거절한다', async () => {
    const pc = await createHarness({ desktop: true }, { shutdownToken: 'a'.repeat(48) });
    try {
      for (const query of ['', 'short', 'f'.repeat(65), 'G'.repeat(64), `${'a'.repeat(64)}&challenge=${'b'.repeat(64)}`]) {
        expect((await pc.app.inject({ method: 'GET', url: `/api/health?challenge=${query}` })).statusCode).toBe(400);
      }
    } finally { await pc.close(); }
  });
});
