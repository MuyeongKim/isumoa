import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { appendAccess } from '../lib/logChain.ts';

// 접속기록: 로그인한 사용자가 보낸 요청을 모두 남긴다 (누가·언제·어디서·무엇을 조회하거나 바꿨는지).
// 개인정보 안전성 확보조치 기준의 "접속기록"(계정, 접속일시, 접속지, 처리한 정보주체, 수행업무)에 해당한다.
// 화면이 몇 초마다 자동으로 묻는 요청과 목록용 작은 이미지는 사람이 한 일이 아니어서 남기지 않는다.

const SKIP = [/^\/api\/processing$/, /^\/api\/overview$/, /^\/api\/auth\/me$/, /^\/api\/meta$/, /^\/api\/pages\/\d+\/thumb$/];

export function registerAccessLog(app: FastifyInstance, db: Kysely<DB>) {
  app.addHook('onResponse', async (req, reply) => {
    const user = req.user;
    if (!user || !req.url.startsWith('/api/')) return;
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && SKIP.some((re) => re.test(path))) return;
    try {
      await appendAccess(db, {
        at: nowIso(),
        user_id: user.id,
        user_login: user.loginId,
        method: req.method,
        path: req.url.slice(0, 500),
        status: reply.statusCode,
        ip: req.ip,
        ms: Math.round(reply.elapsedTime),
      });
    } catch (err) {
      req.log.error(err, '접속기록을 남기지 못했습니다');
    }
  });
}
