import { readFileSync } from 'node:fs';
import type { Kysely } from 'kysely';
import type { CertificateFlag, Training } from '../../../shared/types.ts';
import { AiError, createAiClient } from '../ai/client.ts';
import { aiFailureMessage, extractCertificates, ExtractionError } from '../ai/extract.ts';
import type { AiHealth } from '../ai/health.ts';
import { PROMPT_VERSION } from '../ai/prompt.ts';
import { externalUseProblem, loadAiSettings, useVision, type AiSettings } from '../ai/settings.ts';
import type { AppConfig } from '../config.ts';
import type { DB } from '../db/schema.ts';
import { maskRrn } from '../lib/privacy.ts';
import { nameKey } from '../lib/text.ts';
import type { OcrEngine } from '../ocr/tesseract.ts';
import { pageImagePath } from '../storage.ts';
import { normalizeAi, type ReadFields } from './normalize.ts';
import { hasUsableText, parseCertificateText } from './parseText.ts';

// 쪽 하나에서 이수증 값을 읽는다.
//   1) 글자 확보: PDF 글자층이 쓸 만하면 그대로, 아니면 OCR (스캔본은 AI를 써도 항상 OCR해서 대조한다)
//   2) 규칙 판독: 항상 한다 (AI가 없거나 실패해도 결과가 나오게)
//   3) AI 판독: 켜져 있으면 — 이미지를 읽는 모델이면 스캔 이미지를, 아니면 글자를 보낸다
//   4) 합치기: AI 값을 먼저 쓰되, 규칙과 다르게 읽은 값은 "확인할 점"으로 남긴다

export interface RecognizeDeps {
  db: Kysely<DB>;
  dataDir: string;
  ocr: OcrEngine;
  config: AppConfig;
  aiHealth: AiHealth;
}

export interface PageForRecognition {
  id: number;
  file_id: number;
  page_no: number;
  text_layer: string | null;
  ocr_text: string | null;
}

export type Route = 'text' | 'ocr' | 'ai-text' | 'ai-ocr' | 'ai-vision';

/** AI와 규칙이 같은 칸을 다르게 읽은 것 */
export interface Difference {
  field: 'name' | 'date' | 'hours';
  ai: string;
  rules: string;
}

export interface RecognizedCertificate extends ReadFields {
  source: 'rules' | 'ai';
  aiCodes: string[];
  /** 인식할 때 남긴 확인할 점 */
  notes: CertificateFlag[];
  /** AI와 규칙이 다르게 읽은 칸 (직원 명단과 맞춰 본 뒤 확인할 점으로 만든다 — processPage.ts) */
  differences: Difference[];
  /** 규칙이 읽은 이름 (AI 이름으로 직원을 못 찾을 때 대신 쓴다) */
  rulesName: string | null;
}

export interface Recognition {
  route: Route;
  /** 쪽의 글자 (PDF 글자층 또는 OCR) */
  text: string;
  certificates: RecognizedCertificate[];
  ai: { raw: string | null; model: string | null; ms: number | null; error: string | null; promptVersion: string } | null;
}

const warning = (code: string, message: string): CertificateFlag => ({ code, level: 'warning', message });
const info = (code: string, message: string): CertificateFlag => ({ code, level: 'info', message });

function squeeze(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '');
}

export async function recognizePage(
  deps: RecognizeDeps,
  page: PageForRecognition,
  trainings: Training[],
  options: { finalAttempt: boolean; /** 저장된 설정 대신 쓸 AI 설정 (정확도 점검에서 모델을 바꿔 볼 때) */ settings?: AiSettings },
): Promise<Recognition> {
  const { db } = deps;

  // 1) 글자 확보
  const textSource: 'pdf' | 'ocr' = hasUsableText(page.text_layer) ? 'pdf' : 'ocr';
  let text: string;
  if (textSource === 'pdf') {
    text = page.text_layer!;
  } else {
    // 앞에서 OCR까지 하고 꺼졌다면 그 결과를 다시 쓴다
    text = page.ocr_text ?? maskRrn(await deps.ocr.recognize(pageImagePath(deps.dataDir, page.file_id, page.page_no, 'image')));
    if (page.ocr_text === null) await db.updateTable('pages').set({ ocr_text: text }).where('id', '=', page.id).execute();
  }

  // 2) 규칙 판독
  const rules = parseCertificateText(text);
  const rulesOnly = (notes: CertificateFlag[] = []): RecognizedCertificate => ({
    ...rules,
    source: 'rules',
    aiCodes: [],
    notes,
    differences: [],
    rulesName: rules.personName,
  });

  // 3) AI 판독
  const settings = options.settings ?? (await loadAiSettings(db));
  if (!settings.enabled) {
    return { route: textSource === 'pdf' ? 'text' : 'ocr', text, certificates: [rulesOnly()], ai: null };
  }
  const aiRecord = { raw: null as string | null, model: null as string | null, ms: null as number | null, error: null as string | null, promptVersion: PROMPT_VERSION };
  const fallback = (error: string): Recognition => {
    aiRecord.error = error;
    return {
      route: textSource === 'pdf' ? 'text' : 'ocr',
      text,
      certificates: [rulesOnly([info('ai-failed', `AI로 읽지 못해 규칙으로만 읽었습니다 (${error}). AI가 정상이 되면 '다시 읽기'로 다시 읽을 수 있습니다.`)])],
      ai: aiRecord,
    };
  };

  const blocked = externalUseProblem(settings, deps.config);
  if (blocked) {
    deps.aiHealth.recordFailure(blocked);
    return fallback(blocked);
  }
  if (deps.aiHealth.resting()) {
    const message = `AI 서버 장애로 잠시 쉬는 중: ${deps.aiHealth.error()}`;
    if (!options.finalAttempt) throw new AiError('connection', message); // 대기열이 조금 뒤에 다시 시도한다
    return fallback(message);
  }

  const vision = textSource === 'ocr' && useVision(settings);
  let extraction;
  try {
    const result = await extractCertificates(createAiClient(settings), settings, {
      trainings,
      text,
      textSource,
      image: vision ? readFileSync(pageImagePath(deps.dataDir, page.file_id, page.page_no, 'image')) : null,
    });
    deps.aiHealth.recordSuccess();
    Object.assign(aiRecord, { raw: maskRrn(result.raw), model: result.model, ms: result.ms });
    extraction = result.extraction;
  } catch (err) {
    const message = aiFailureMessage(err);
    if (err instanceof AiError) {
      if (err.retryable || err.kind === 'auth' || err.kind === 'bad-request') deps.aiHealth.recordFailure(message);
      if (err.retryable && !options.finalAttempt) throw err;
    }
    if (err instanceof ExtractionError) Object.assign(aiRecord, { raw: maskRrn(err.raw), model: err.model });
    return fallback(message);
  }

  // 4) 합치기
  const route: Route = vision ? 'ai-vision' : textSource === 'pdf' ? 'ai-text' : 'ai-ocr';
  const read = extraction.certificates.map(normalizeAi);
  if (read.length === 0) {
    const notes = extraction.isCertificate ? [] : [warning('not-certificate', 'AI가 이수증이 아닌 쪽(표지·공문·빈 쪽 등)으로 봤습니다. 맞으면 제외해 주세요.')];
    return { route, text, certificates: [rulesOnly(notes)], ai: aiRecord };
  }
  if (read.length === 1) {
    return { route, text, certificates: [mergeWithRules(read[0], extraction.certificates[0].trainingCodes, rules, text, textSource)], ai: aiRecord };
  }
  // 한 쪽에 여러 장: 규칙 판독은 한 장만 읽으므로 AI 값만 쓴다
  return {
    route,
    text,
    certificates: read.map((fields, i) => ({
      ...fields,
      source: 'ai' as const,
      aiCodes: extraction.certificates[i].trainingCodes,
      notes: [info('multi-certificate', `이 쪽에서 이수증 ${read.length}장을 읽었습니다 (${i + 1}번째). 원본과 대조해 주세요.`)],
      differences: [],
      rulesName: null,
    })),
    ai: aiRecord,
  };
}

/**
 * AI 값과 규칙 값을 합친다. 기본은 AI 값이고, AI가 비워 둔 칸은 규칙 값으로 채운다.
 * PDF 글자층이 있는 쪽에서 AI가 고른 이름·번호가 글자층에 없으면(지어낸 값) 규칙 값을 쓴다.
 * 서로 다르게 읽은 칸은 differences로 남긴다.
 */
export function mergeWithRules(
  ai: ReadFields,
  aiCodes: string[],
  rules: ReadFields,
  text: string,
  textSource: 'pdf' | 'ocr',
): RecognizedCertificate {
  const haystack = squeeze(text);
  const grounded = (value: string | null) => value === null || textSource !== 'pdf' || haystack.includes(squeeze(value));

  const merged: ReadFields = {
    personName: grounded(ai.personName) ? (ai.personName ?? rules.personName) : (rules.personName ?? ai.personName),
    personBirth: ai.personBirth ?? rules.personBirth,
    personDept: ai.personDept ?? rules.personDept,
    courseTitle: ai.courseTitle ?? rules.courseTitle,
    provider: ai.provider ?? rules.provider,
    certNo: grounded(ai.certNo) ? (ai.certNo ?? rules.certNo) : (rules.certNo ?? ai.certNo),
    completedOn: ai.completedOn ?? rules.completedOn,
    hours: ai.hours ?? rules.hours,
    hoursText: ai.hours !== null || ai.hoursText ? ai.hoursText : rules.hoursText,
    hoursInSessions: ai.hours !== null || ai.hoursText ? ai.hoursInSessions : rules.hoursInSessions,
  };

  const differences: Difference[] = [];
  if (ai.personName && rules.personName && nameKey(ai.personName) !== nameKey(rules.personName)) {
    differences.push({ field: 'name', ai: ai.personName, rules: rules.personName });
  }
  if (ai.completedOn && rules.completedOn && ai.completedOn !== rules.completedOn) {
    differences.push({ field: 'date', ai: ai.completedOn, rules: rules.completedOn });
  }
  if (ai.hours !== null && rules.hours !== null && ai.hours !== rules.hours) {
    differences.push({ field: 'hours', ai: `${ai.hours}시간`, rules: `${rules.hours}시간` });
  }
  return { ...merged, source: 'ai', aiCodes, notes: [], differences, rulesName: rules.personName };
}
