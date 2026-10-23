import Anthropic from '@anthropic-ai/sdk';
import type { AiJsonMode } from '../../../shared/types.ts';
import type { AiSettings } from './settings.ts';

// AI 서버에 한 번 묻고 답(글자)을 받는 부분. 두 종류를 지원한다:
//  - openai-compatible: Ollama, vLLM, 기관 AI 서버 등 "/v1/chat/completions" 형식 (로컬·내부망)
//  - anthropic: Claude API (인터넷, 공식 SDK 사용)
// 답을 JSON으로 바꾸고 검사하는 일은 extract.ts가 한다.

export interface AiRequest {
  system: string;
  user: string;
  /** 이수증 쪽 이미지 (JPEG). 이미지를 읽지 못하는 모델이면 넣지 않는다 */
  imageJpeg?: Buffer | null;
  /** 답의 JSON 모양 */
  schema: Record<string, unknown>;
  /** openai-compatible에서 JSON을 강제하는 방법 (연결 테스트에서 정한다) */
  jsonMode: AiJsonMode;
  maxTokens: number;
}

export interface AiReply {
  text: string;
  /** 실제로 답한 모델 (Claude는 대체 모델로 답할 수 있다) */
  model: string;
  /** stop: 정상, length: 길이 제한으로 잘림 */
  finish: 'stop' | 'length' | 'other';
  /** 답에 생각 과정(<think> 또는 reasoning 칸)이 섞여 왔는지 */
  thinking: boolean;
  ms: number;
}

export interface AiClient {
  readonly label: string;
  complete(request: AiRequest): Promise<AiReply>;
}

/**
 * AI 호출 실패. kind로 "다시 시도하면 될 일"(연결·시간 초과·서버 오류·요청 한도)과
 * "설정을 고쳐야 할 일"(인증·잘못된 요청·거절)을 나눈다.
 */
export class AiError extends Error {
  readonly kind: 'connection' | 'timeout' | 'server' | 'rate-limit' | 'auth' | 'bad-request' | 'refusal';
  constructor(kind: AiError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
  get retryable(): boolean {
    return ['connection', 'timeout', 'server', 'rate-limit'].includes(this.kind);
  }
}

export function parseExtraBody(text: string): Record<string, unknown> {
  if (text.trim() === '') return {};
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('추가 파라미터는 { } 로 감싼 JSON이어야 합니다.');
  return value as Record<string, unknown>;
}

export function createAiClient(settings: AiSettings): AiClient {
  return settings.provider === 'anthropic' ? anthropicClient(settings) : openAiCompatibleClient(settings);
}

// ---------------------------------------------------------------------------
// OpenAI 호환 (Ollama · vLLM · 기관 AI 서버)

function openAiCompatibleClient(settings: AiSettings): AiClient {
  const url = `${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const extra = parseExtraBody(settings.extraBody);

  return {
    label: `${settings.model} @ ${settings.baseUrl}`,
    async complete(request) {
      const system = request.jsonMode === 'prompt' ? `${request.system}\n\n${JSON_ONLY_HINT}` : request.system;
      const userContent = request.imageJpeg
        ? [
            { type: 'text', text: request.user },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${request.imageJpeg.toString('base64')}` } },
          ]
        : request.user;
      const body: Record<string, unknown> = {
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: request.maxTokens,
        stream: false,
        ...responseFormat(request),
        ...extra,
      };
      // 추가 파라미터에서 null로 준 항목은 보내지 않는다 (예: {"temperature": null})
      for (const [key, value] of Object.entries(body)) if (value === null) delete body[key];

      const started = Date.now();
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(settings.timeoutSeconds * 1000),
        });
      } catch (err) {
        throw fetchError(err, settings);
      }
      const raw = await res.text();
      if (!res.ok) throw httpError(res.status, raw);

      let data: OpenAiResponse;
      try {
        data = JSON.parse(raw) as OpenAiResponse;
      } catch {
        throw new AiError('server', 'AI 서버의 답이 JSON 형식이 아닙니다. 주소가 "/v1"로 끝나는 OpenAI 호환 주소인지 확인해 주세요.');
      }
      const choice = data.choices?.[0];
      if (!choice) throw new AiError('server', 'AI 서버의 답에 내용(choices)이 없습니다.');
      const content = contentText(choice.message?.content);
      const reasoning = choice.message?.reasoning_content ?? choice.message?.reasoning ?? '';
      return {
        text: content,
        model: data.model ?? settings.model,
        finish: choice.finish_reason === 'length' ? 'length' : choice.finish_reason === 'stop' ? 'stop' : 'other',
        thinking: reasoning.trim() !== '' || /<\/think(ing)?>/i.test(content),
        ms: Date.now() - started,
      };
    },
  };
}

const JSON_ONLY_HINT = '반드시 JSON 객체 하나만 답하세요. 코드 블록(```)이나 설명 문장을 붙이지 마세요.';

function responseFormat(request: AiRequest): Record<string, unknown> {
  if (request.jsonMode === 'json_schema') {
    return { response_format: { type: 'json_schema', json_schema: { name: 'certificate_extraction', strict: true, schema: request.schema } } };
  }
  if (request.jsonMode === 'json_object') return { response_format: { type: 'json_object' } };
  return {};
}

interface OpenAiResponse {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: unknown; reasoning_content?: string | null; reasoning?: string | null };
  }[];
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : '')).join('');
  }
  return '';
}

function fetchError(err: unknown, settings: AiSettings): AiError {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new AiError('timeout', `AI 서버가 ${settings.timeoutSeconds}초 안에 답하지 않았습니다.`);
  }
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : err instanceof Error ? err.message : String(err);
  return new AiError('connection', `AI 서버(${settings.baseUrl})에 연결하지 못했습니다: ${cause}`);
}

function httpError(status: number, raw: string): AiError {
  let detail = raw.slice(0, 300);
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    detail = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? parsed.message ?? detail;
  } catch {
    // 그대로 둔다
  }
  if (status === 401 || status === 403) return new AiError('auth', `AI 서버가 인증을 거부했습니다(${status}). API 키를 확인해 주세요. ${detail}`);
  if (status === 404) return new AiError('bad-request', `AI 서버에서 주소나 모델을 찾지 못했습니다(404). 주소와 모델 이름을 확인해 주세요. ${detail}`);
  if (status === 429) return new AiError('rate-limit', `AI 서버의 요청 한도를 넘었습니다(429). 잠시 뒤 다시 시도합니다. ${detail}`);
  if (status >= 500) return new AiError('server', `AI 서버 오류(${status}): ${detail}`);
  return new AiError('bad-request', `AI 서버가 요청을 받지 않았습니다(${status}): ${detail}`);
}

// ---------------------------------------------------------------------------
// Claude API (Anthropic)

function anthropicClient(settings: AiSettings): AiClient {
  const client = new Anthropic({
    apiKey: settings.apiKey ?? undefined,
    baseURL: settings.baseUrl.trim() || undefined,
    timeout: settings.timeoutSeconds * 1000,
    maxRetries: 1, // 더 기다려야 하면 대기열이 10초·1분 뒤에 다시 시도한다
  });

  return {
    label: `${settings.model} (Claude API)`,
    async complete(request) {
      const started = Date.now();
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await client.beta.messages.create({
          model: settings.model,
          max_tokens: 16000,
          // 모델이 정책상 답을 거절하면 서버가 대체 모델로 한 번 더 시도한다 (지원하지 않는 모델은 그대로 실행)
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: request.system,
          output_config: {
            effort: settings.effort,
            format: { type: 'json_schema', schema: request.schema },
          },
          messages: [
            {
              role: 'user',
              content: [
                ...(request.imageJpeg
                  ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: request.imageJpeg.toString('base64') } }]
                  : []),
                { type: 'text' as const, text: request.user },
              ],
            },
          ],
        });
      } catch (err) {
        throw anthropicError(err, settings);
      }
      if (message.stop_reason === 'refusal') {
        throw new AiError('refusal', 'Claude가 이 쪽에 대한 답을 거절했습니다. 규칙으로 읽은 값으로 검수해 주세요.');
      }
      const text = message.content
        .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');
      return {
        text,
        model: message.model,
        finish: message.stop_reason === 'max_tokens' ? 'length' : message.stop_reason === 'end_turn' ? 'stop' : 'other',
        thinking: false, // Claude는 생각 과정을 별도 블록으로 주므로 답 글자에 섞이지 않는다
        ms: Date.now() - started,
      };
    },
  };
}

function anthropicError(err: unknown, settings: AiSettings): AiError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError('timeout', `Claude API가 ${settings.timeoutSeconds}초 안에 답하지 않았습니다.`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('connection', `Claude API에 연결하지 못했습니다. 인터넷 연결(또는 기관 방화벽)을 확인해 주세요: ${err.message}`);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('auth', `Claude API가 인증을 거부했습니다(${err.status}). API 키를 확인해 주세요.`);
  }
  if (err instanceof Anthropic.RateLimitError) return new AiError('rate-limit', 'Claude API 요청 한도를 넘었습니다. 잠시 뒤 다시 시도합니다.');
  if (err instanceof Anthropic.NotFoundError) return new AiError('bad-request', `Claude API에서 모델 '${settings.model}'을(를) 찾지 못했습니다.`);
  if (err instanceof Anthropic.InternalServerError) return new AiError('server', `Claude API 서버 오류(${err.status}): ${err.message}`);
  if (err instanceof Anthropic.APIError) return new AiError('bad-request', `Claude API가 요청을 받지 않았습니다(${err.status}): ${err.message}`);
  if (!settings.apiKey && err instanceof Error && /api ?key/i.test(err.message)) {
    return new AiError('auth', 'Claude API 키가 없습니다. AI 연결 설정에서 API 키를 넣어 주세요.');
  }
  return new AiError('connection', err instanceof Error ? err.message : String(err));
}
