import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { ServerOptions as HttpsOptions } from 'node:https';
import Fastify, { LogController, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { registerAccessLog } from './auth/accessLog.ts';
import { registerAuth } from './auth/guard.ts';
import type { Deps } from './deps.ts';
import { errorHandler } from './lib/errors.ts';
import { auditRoutes } from './routes/audit.ts';
import { authRoutes } from './routes/auth.ts';
import { certificateRoutes } from './routes/certificates.ts';
import { departmentRoutes } from './routes/departments.ts';
import { employeeRoutes } from './routes/employees.ts';
import { exportRoutes } from './routes/exports.ts';
import { overviewRoutes } from './routes/overview.ts';
import { securityRoutes } from './routes/security.ts';
import { statusRoutes } from './routes/status.ts';
import { systemRoutes } from './routes/system.ts';
import { trainingRoutes } from './routes/trainings.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { userRoutes } from './routes/users.ts';

/** 서버 앱을 만든다. 테스트에서는 메모리 DB를 넣어 그대로 쓴다 */
export async function buildApp(deps: Deps, options: { logger?: FastifyServerOptions['logger']; https?: HttpsOptions | null } = {}) {
  // https를 주면 Fastify가 HTTPS 서버로 만든다 (타입은 http 서버로 맞춰 다른 코드와 같이 쓴다)
  const app = Fastify({
    logger: options.logger ?? { level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: deps.config.trustProxy,
    bodyLimit: 5 * 1024 * 1024,
    ...(options.https ? { https: options.https } : {}),
  } as FastifyServerOptions) as unknown as FastifyInstance;

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
  registerAuth(app, deps);
  registerAccessLog(app, deps.db);
  app.setErrorHandler(errorHandler);

  // 기본 보안 헤더 (외부 사이트 리소스를 쓰지 않으므로 'self'만 허용)
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    // HTTPS로 운영하면 브라우저가 앞으로도 HTTPS로만 접속하게 한다
    if (options.https) reply.header('Strict-Transport-Security', 'max-age=31536000');
    reply.header(
      'Content-Security-Policy',
      // 'wasm-unsafe-eval': PDF 처리(pdf.js)가 스캔 이미지 해독에 WebAssembly를 쓴다
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'",
    );
  });

  await app.register(authRoutes, deps);
  await app.register(overviewRoutes, deps);
  await app.register(departmentRoutes, deps);
  await app.register(userRoutes, deps);
  await app.register(trainingRoutes, deps);
  await app.register(employeeRoutes, deps);
  await app.register(uploadRoutes, deps);
  await app.register(certificateRoutes, deps);
  await app.register(statusRoutes, deps);
  await app.register(exportRoutes, deps);
  await app.register(auditRoutes, deps);
  await app.register(securityRoutes, deps);
  await app.register(systemRoutes, deps);

  // 빌드된 화면이 있으면 같은 포트에서 제공한다 (개발 중에는 Vite가 따로 띄운다)
  const webDist = deps.config.webDistDir;
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      setHeaders(res, path) {
        res.header('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  // 화면 주소(/employees 등)는 index.html을 주고, 없는 파일(.js 등)이나 API는 404로 답한다
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    const isPageRoute = !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
    if (req.method === 'GET' && isPageRoute && existsSync(join(webDist, 'index.html'))) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: { message: '요청한 주소를 찾을 수 없습니다.' } });
  });

  return app;
}
