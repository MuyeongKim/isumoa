import type { AiJsonMode, Training } from '../../../shared/types.ts';
import { AiError, type AiClient } from './client.ts';
import { extractJson } from './json.ts';
import { JSON_SHAPE_HINT, SYSTEM_PROMPT, userPrompt } from './prompt.ts';
import { EXTRACTION_JSON_SCHEMA, Extraction } from './schema.ts';
import type { AiSettings } from './settings.ts';

// 이수증 한 쪽을 AI로 읽는다. 답이 JSON 모양이 아니면 무엇이 틀렸는지 알려 주고 한 번 더 묻는다.

export interface ExtractInput {
  trainings: Training[];
  text: string | null;
  textSource: 'pdf' | 'ocr' | null;
  image: Buffer | null;
  /** 연결 테스트에서 JSON 모드를 바꿔 가며 시험할 때만 */
  jsonMode?: AiJsonMode;
}

export interface ExtractResult {
  extraction: Extraction;
  /** AI 답 원문 (다시 물었으면 모두 이어 붙임) */
  raw: string;
  model: string;
  ms: number;
  /** 답에 생각 과정이 섞여 왔는지 */
  thinking: boolean;
}

/** AI가 답은 했지만 쓸 수 있는 JSON이 아니었음 */
export class ExtractionError extends Error {
  readonly raw: string;
  readonly model: string | null;
  constructor(message: string, raw: string, model: string | null) {
    super(message);
    this.raw = raw;
    this.model = model;
  }
}

export function jsonModeOf(settings: AiSettings): AiJsonMode {
  if (settings.provider === 'anthropic') return 'json_schema';
  return settings.probe?.jsonMode ?? 'json_object';
}

export async function extractCertificates(client: AiClient, settings: AiSettings, input: ExtractInput): Promise<ExtractResult> {
  const jsonMode = input.jsonMode ?? jsonModeOf(settings);
  const base = {
    // 스키마를 서버에 넘기지 못하는 방식이면 답의 모양을 지시문에 직접 적는다
    system: jsonMode === 'json_schema' ? SYSTEM_PROMPT : `${SYSTEM_PROMPT}\n\n${JSON_SHAPE_HINT}`,
    user: userPrompt({ trainings: input.trainings, text: input.text, textSource: input.textSource, hasImage: input.image !== null }),
    imageJpeg: input.image,
    schema: EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    jsonMode,
    // 이수증 한두 장의 JSON은 600토큰 안팎이다. 넉넉히 두되, 모델이 같은 말을 되풀이하며
    // 멈추지 않을 때 오래 붙잡히지 않도록 짧게 자른다 (잘리면 한 번 더 묻는다)
    maxTokens: 1500,
  };
  const raws: string[] = [];
  let model: string | null = null;
  let ms = 0;
  let thinking = false;
  let problem = '';
  let request = base;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await client.complete(request);
    raws.push(reply.text);
    model = reply.model;
    ms += reply.ms;
    thinking ||= reply.thinking;

    if (reply.finish === 'length') {
      problem = reply.thinking
        ? 'AI의 생각 과정이 길어 답이 잘렸습니다. AI 연결 설정의 추가 파라미터로 생각 과정(thinking)을 꺼 주세요.'
        : '답이 길이 제한에서 잘렸습니다.';
      if (reply.thinking) break; // 같은 설정으로 다시 물어도 또 잘린다
    } else {
      try {
        const parsed = Extraction.safeParse(extractJson(reply.text));
        if (parsed.success) return { extraction: parsed.data, raw: raws.join('\n---\n'), model, ms, thinking };
        problem = `JSON 모양이 다릅니다: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(전체)'} ${i.message}`).join('; ')}`;
      } catch (err) {
        problem = err instanceof Error ? err.message : String(err);
      }
    }
    request = { ...base, user: `${base.user}\n\n앞의 답은 쓸 수 없었습니다 (${problem}). 정해진 JSON 모양으로만 다시 답하세요.` };
  }
  throw new ExtractionError(`AI 답을 읽지 못했습니다: ${problem}`, raws.join('\n---\n'), model);
}

export function aiFailureMessage(err: unknown): string {
  if (err instanceof AiError || err instanceof ExtractionError) return err.message;
  return `AI 처리 중 오류: ${err instanceof Error ? err.message : String(err)}`;
}
