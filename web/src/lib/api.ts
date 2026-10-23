// 서버 API 호출. 데이터를 바꾸는 요청에는 서버가 확인하는 x-requested-with 헤더를 붙인다.
import { withBase } from './base.ts';

export class ApiError extends Error {
  status: number;
  code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-requested-with': 'fetch' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(withBase(`/api${path}`), { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인해 주세요.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? `요청을 처리하지 못했습니다. (${res.status})`, data?.error?.code);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
}
