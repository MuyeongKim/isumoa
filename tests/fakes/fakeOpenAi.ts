import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

// 시험용 가짜 AI 서버 (127.0.0.1에서만). 답을 테스트가 정한다.
//  - OpenAI 호환: POST /v1/chat/completions
//  - Claude API 모양: POST /v1/messages (SDK의 요청 모양과 답 처리를 돈 들이지 않고 확인)
// 일부러 장애(500·연결 끊김)나 이상한 답(설명 섞인 JSON, 잘린 답)을 낼 수 있다.

export interface FakeRequest {
  path: string;
  body: {
    model: string;
    messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[];
    response_format?: { type: string };
    [key: string]: unknown;
  };
  headers: IncomingHttpHeaders;
}

export type FakeReply = { status?: number; json?: unknown; raw?: string; hangUp?: boolean };

export interface FakeAi {
  /** http://127.0.0.1:포트/v1 */
  url: string;
  /** http://127.0.0.1:포트 (Claude SDK의 baseURL) */
  origin: string;
  requests: FakeRequest[];
  /** 요청마다 답을 정한다 */
  respond: (request: FakeRequest) => FakeReply;
  close(): Promise<void>;
}

/** 정상 답 모양 */
export function chat(content: string, finish = 'stop'): FakeReply {
  return { json: { model: 'fake-model', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }] } };
}

export function certificateJson(fields: Record<string, unknown> = {}, extra: { isCertificate?: boolean; more?: Record<string, unknown>[] } = {}): string {
  const base = {
    personName: null,
    birthDate: null,
    department: null,
    courseTitle: null,
    provider: null,
    certificateNo: null,
    completionDate: null,
    periodStart: null,
    periodEnd: null,
    hours: null,
    trainingCodes: [],
  };
  const certificates = extra.isCertificate === false ? [] : [{ ...base, ...fields }, ...(extra.more ?? []).map((m) => ({ ...base, ...m }))];
  return JSON.stringify({ isCertificate: extra.isCertificate ?? true, certificates });
}

/** Claude Messages API 답 모양 */
export function claudeMessage(text: string, stopReason = 'end_turn'): FakeReply {
  return {
    json: {
      id: 'msg_fake',
      type: 'message',
      role: 'assistant',
      model: 'claude-fake',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    },
  };
}

/** 보낸 글(user 메시지의 글자 부분) */
export function userText(request: FakeRequest): string {
  const content = request.body.messages.find((m) => m.role === 'user')?.content;
  if (typeof content === 'string') return content;
  return (content ?? []).map((p) => p.text ?? '').join('');
}

export function hasImage(request: FakeRequest): boolean {
  const content = request.body.messages.find((m) => m.role === 'user')?.content;
  return Array.isArray(content) && content.some((p) => p.type === 'image_url' || p.type === 'image');
}

export async function startFakeOpenAi(): Promise<FakeAi> {
  const fake: FakeAi = {
    url: '',
    origin: '',
    requests: [],
    respond: () => chat(certificateJson()),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/messages'].includes(path)) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      const request: FakeRequest = { path, body: JSON.parse(raw), headers: req.headers };
      fake.requests.push(request);
      const reply = fake.respond(request);
      if (reply.hangUp) {
        req.socket.destroy();
        return;
      }
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
      res.end(reply.raw ?? JSON.stringify(reply.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.url = `${fake.origin}/v1`;
  return fake;
}
