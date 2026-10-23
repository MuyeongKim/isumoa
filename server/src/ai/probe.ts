import { readFileSync } from 'node:fs';
import type { AiJsonMode, AiProbeResult, Training } from '../../../shared/types.ts';
import { normalizeAi } from '../certs/normalize.ts';
import { nameKey } from '../lib/text.ts';
import { AiError, createAiClient, parseExtraBody } from './client.ts';
import { extractCertificates, ExtractionError, type ExtractResult } from './extract.ts';
import type { AiSettings } from './settings.ts';

// "AI 연결 테스트": 설치본에 들어 있는 가상 이수증(윤하늘, 4대폭력 통합교육)으로
//  1) 글자 읽기 — JSON 모드를 json_schema → json_object → 지시문만 순서로 시험
//  2) 이미지 읽기 — 이미지만 보내 이름을 맞게 읽는지
// 를 확인하고 걸린 시간을 잰다. 실제 직원 정보는 보내지 않는다.

const ASSETS = new URL('../../assets/', import.meta.url);
const probeData = () =>
  JSON.parse(readFileSync(new URL('probe-certificate.json', ASSETS), 'utf8')) as {
    text: string;
    expected: { personName: string; completedOn: string; hours: number; courseTitle: string };
  };
const probeImage = () => readFileSync(new URL('probe-certificate.jpg', ASSETS));

export async function probeAi(settings: AiSettings, trainings: Training[]): Promise<AiProbeResult> {
  const result: AiProbeResult = {
    ok: false,
    testedAt: new Date().toISOString(),
    jsonMode: null,
    vision: null,
    thinkingLeak: false,
    latencyMs: null,
    sample: null,
    notes: [],
    error: null,
  };
  try {
    parseExtraBody(settings.extraBody);
  } catch (err) {
    result.error = `추가 파라미터를 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
  if (settings.provider === 'anthropic' && !settings.apiKey) {
    result.error = 'Claude API 키를 넣어 주세요.';
    return result;
  }

  const client = createAiClient(settings);
  const { text, expected } = probeData();
  const check = (r: ExtractResult) => {
    const first = r.extraction.certificates[0];
    const fields = first ? normalizeAi(first) : null;
    return {
      fields,
      nameOk: !!fields?.personName && nameKey(fields.personName) === nameKey(expected.personName),
      dateOk: fields?.completedOn === expected.completedOn,
    };
  };

  // 1) 글자 읽기
  const modes: AiJsonMode[] = settings.provider === 'anthropic' ? ['json_schema'] : ['json_schema', 'json_object', 'prompt'];
  let textResult: ExtractResult | null = null;
  for (const mode of modes) {
    try {
      textResult = await extractCertificates(client, settings, { trainings, text, textSource: 'pdf', image: null, jsonMode: mode });
      result.jsonMode = mode;
      break;
    } catch (err) {
      if (err instanceof AiError && err.kind !== 'bad-request') {
        result.error = err.message;
        return result;
      }
      result.notes.push(`${MODE_LABEL[mode]}: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof ExtractionError && /생각 과정/.test(err.message)) result.thinkingLeak = true;
    }
  }
  if (!textResult) {
    result.error = 'AI가 이수증 정보를 JSON으로 답하지 못했습니다. 모델이나 추가 파라미터를 바꿔 보세요.';
    return result;
  }

  result.ok = true;
  result.latencyMs = textResult.ms;
  result.thinkingLeak ||= textResult.thinking;
  const textCheck = check(textResult);
  result.sample = {
    personName: textCheck.fields?.personName ?? null,
    courseTitle: textCheck.fields?.courseTitle ?? null,
    completionDate: textCheck.fields?.completedOn ?? null,
  };
  result.notes.push(`답 형식: ${MODE_LABEL[result.jsonMode!]}`);
  if (!textCheck.nameOk || !textCheck.dateOk) {
    result.notes.push(`글자 읽기 결과가 정답과 다릅니다 (정답: ${expected.personName}, ${expected.completedOn}). 더 큰 모델을 권합니다.`);
  }
  const codes = textResult.extraction.certificates[0]?.trainingCodes ?? [];
  if (codes.length > 0) result.notes.push(`AI가 고른 교육 코드: ${codes.join(', ')}`);
  if (result.thinkingLeak) {
    result.notes.push('답에 생각 과정(thinking)이 섞여 옵니다. 느려지고 답이 잘릴 수 있으니 추가 파라미터로 꺼 주세요.');
  }

  // 2) 이미지 읽기
  if (settings.vision === 'off') {
    result.notes.push('이미지 읽기: 끔 (스캔본은 OCR 글자를 AI에 보냅니다)');
    return result;
  }
  try {
    const imageResult = await extractCertificates(client, settings, { trainings, text: null, textSource: null, image: probeImage(), jsonMode: result.jsonMode! });
    const imageCheck = check(imageResult);
    result.vision = imageCheck.nameOk;
    result.notes.push(
      imageCheck.nameOk
        ? `이미지 읽기: 가능 (${Math.round(imageResult.ms / 100) / 10}초)`
        : `이미지 읽기: 이미지는 받았지만 이름을 '${imageCheck.fields?.personName ?? '(없음)'}'(으)로 읽었습니다(정답 ${expected.personName}). 스캔본은 OCR 글자로 읽습니다.`,
    );
  } catch (err) {
    result.vision = err instanceof AiError && err.retryable ? null : false;
    result.notes.push(`이미지 읽기: 안 됨 — ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

const MODE_LABEL: Record<AiJsonMode, string> = {
  json_schema: 'JSON 스키마 강제(json_schema)',
  json_object: 'JSON 모드(json_object)',
  prompt: '지시문만(JSON 모드 없음)',
};
