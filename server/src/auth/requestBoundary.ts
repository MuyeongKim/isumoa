import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../config.ts';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** 직접 접속하는 PC판은 DNS 재바인딩을 막고, 쓰기 요청은 같은 출처에서만 받는다. */
export function registerRequestBoundary(app: FastifyInstance, config: AppConfig) {
  app.addHook('onRequest', async (req, reply) => {
    let target: URL;
    try {
      const host = req.headers.host;
      if (!host || /[\s/@\\?#]/.test(host)) throw Error('invalid host');
      target = new URL(`${req.protocol}://${host}`);
    } catch {
      return reply.code(403).send({ error: { message: '허용되지 않은 접속 주소입니다.' } });
    }
    if ((config.desktop || config.singleUser) && !config.trustProxy && !LOCAL_HOSTS.has(target.hostname)) {
      return reply.code(403).send({ error: { message: 'PC 설치판은 이 PC의 주소로만 접속할 수 있습니다.' } });
    }
    if (!SAFE_METHODS.has(req.method)) {
      // 기존 전용 헤더 검사와 함께 사용한다. PowerShell·CLI처럼 Origin이 없는 요청은 그대로 검사한다.
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin !== undefined && origin !== target.origin)) {
        return reply.code(403).send({ error: { message: '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.' } });
      }
    }
  });
}
