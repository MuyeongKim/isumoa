import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_EFFORTS, AI_PROVIDERS, type AiProbeResult, type AiSettingsView } from '../../../shared/types.ts';
import { requireAdmin } from '../auth/guard.ts';
import { parseExtraBody } from '../ai/client.ts';
import { probeAi } from '../ai/probe.ts';
import { externalUseProblem, fromInput, isExternal, loadAiSettings, saveAiSettings, toView, type AiSettings } from '../ai/settings.ts';
import { loadTrainings } from '../certs/review.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest } from '../lib/errors.ts';

// 설정 > AI 연결 (관리자만). 로컬·내부망 AI(OpenAI 호환)와 Claude API(인터넷)를 고를 수 있다.

const AiSettingsBody = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS),
    baseUrl: z.string().trim().max(300),
    model: z.string().trim().min(1, '모델 이름을 넣어 주세요.').max(200),
    apiKey: z.string().max(500).optional(),
    vision: z.enum(['auto', 'on', 'off']),
    concurrency: z.number().int().min(1, '동시 처리 수는 1~8입니다.').max(8, '동시 처리 수는 1~8입니다.'),
    timeoutSeconds: z.number().int().min(10, '제한 시간은 10~600초입니다.').max(600, '제한 시간은 10~600초입니다.'),
    extraBody: z.string().max(2000),
    effort: z.enum(AI_EFFORTS),
    allowExternal: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.provider === 'openai-compatible' || value.baseUrl !== '') {
      try {
        const url = new URL(value.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      } catch {
        ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: '주소는 http:// 또는 https://로 시작해야 합니다 (예: http://localhost:11434/v1).' });
      }
    }
    try {
      parseExtraBody(value.extraBody);
    } catch (err) {
      ctx.addIssue({ code: 'custom', path: ['extraBody'], message: `추가 파라미터: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

/** 연결에 영향을 주는 값이 같으면 같은 연결로 본다 (연결 테스트 결과를 이어 쓰기 위해) */
function fingerprint(s: Pick<AiSettings, 'provider' | 'baseUrl' | 'model' | 'apiKey' | 'extraBody'>): string {
  return JSON.stringify([s.provider, s.baseUrl.trim(), s.model.trim(), s.apiKey ?? '', s.extraBody.trim()]);
}

export async function aiRoutes(app: FastifyInstance, { db, config, worker, aiHealth }: Deps) {
  // 저장하기 전에 해 본 연결 테스트 결과 (저장할 때 같은 연결이면 함께 저장한다)
  let lastProbe: { fingerprint: string; result: AiProbeResult } | null = null;

  app.get('/api/settings/ai', { preHandler: requireAdmin }, async (): Promise<AiSettingsView> => {
    return toView(await loadAiSettings(db), config);
  });

  app.put('/api/settings/ai', { preHandler: requireAdmin }, async (req): Promise<AiSettingsView> => {
    const body = AiSettingsBody.parse(req.body);
    const current = await loadAiSettings(db);
    const draft = fromInput(body, current, null);
    const fp = fingerprint(draft);
    const probe = lastProbe?.fingerprint === fp ? lastProbe.result : fingerprint(current) === fp ? current.probe : null;
    const next: AiSettings = { ...draft, probe };

    if (next.enabled) {
      const problem = externalUseProblem(next, config);
      if (problem) throw badRequest(problem);
      if (next.provider === 'anthropic' && !next.apiKey) throw badRequest('Claude API 키를 넣어 주세요.');
    }
    await saveAiSettings(db, next);
    aiHealth?.reset();
    worker?.setConcurrency(next.enabled ? next.concurrency : 1);
    await audit(db, req, 'settings.ai', undefined, {
      enabled: next.enabled,
      provider: next.provider,
      baseUrl: next.baseUrl,
      model: next.model,
      external: isExternal(next),
      apiKeyChanged: body.apiKey !== undefined,
    });
    return toView(next, config);
  });

  // 연결 테스트: 저장하지 않은 값으로도 해 볼 수 있다. 가상 이수증만 보낸다.
  app.post('/api/settings/ai/test', { preHandler: requireAdmin }, async (req): Promise<AiProbeResult> => {
    const body = AiSettingsBody.parse(req.body);
    const current = await loadAiSettings(db);
    const candidate = fromInput(body, current, null);
    if (isExternal(candidate) && !config.allowExternalAi) {
      throw badRequest('이 설치본은 기관 밖(인터넷) AI를 쓸 수 없게 설정되어 있습니다 (config.json의 allowExternalAi).');
    }
    const result = await probeAi(candidate, await loadTrainings(db));
    const fp = fingerprint(candidate);
    const previous = lastProbe?.fingerprint === fp ? lastProbe.result : fingerprint(current) === fp ? current.probe : null;
    // 이번에 이미지 읽기를 시험하지 않았으면(끔·시간 초과) 앞서 확인한 결과를 이어 쓴다
    const kept: AiProbeResult = result.vision === null && previous?.vision != null ? { ...result, vision: previous.vision } : result;
    lastProbe = { fingerprint: fp, result: kept };
    // 이미 저장된 연결과 같으면 테스트 결과를 바로 반영한다 (예: 이미지 읽기 가능 여부)
    if (fingerprint(current) === fp) {
      await saveAiSettings(db, { ...current, probe: kept });
      if (result.ok) aiHealth?.reset();
    }
    await audit(db, req, 'settings.ai.test', undefined, {
      provider: candidate.provider,
      baseUrl: candidate.baseUrl,
      model: candidate.model,
      ok: result.ok,
    });
    return result;
  });
}
