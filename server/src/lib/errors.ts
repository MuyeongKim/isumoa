import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

// 입력값 검사 기본 메시지를 한국어로
z.config(z.locales.ko());

/** 사용자에게 그대로 보여줄 메시지를 담은 오류 */
export class HttpError extends Error {
  status: number;
  code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function notFound(message = '대상을 찾을 수 없습니다.'): HttpError {
  return new HttpError(404, message);
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof HttpError) {
    return reply.code(err.status).send({ error: { message: err.message, code: err.code } });
  }
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: { message: err.issues[0]?.message ?? '입력값이 올바르지 않습니다.' } });
  }
  const statusCode = (err as FastifyError).statusCode;
  if (statusCode && statusCode < 500) {
    const message = statusCode === 413 ? '파일이 너무 큽니다.' : '요청을 처리할 수 없습니다.';
    return reply.code(statusCode).send({ error: { message } });
  }
  req.log.error(err);
  return reply.code(500).send({ error: { message: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' } });
}
