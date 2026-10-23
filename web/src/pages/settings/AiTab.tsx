import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, Globe, Server, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { isExternalAi, sameAiTarget } from '@shared/aiHosts.ts';
import type { AiEffort, AiJsonMode, AiProbeResult, AiSettingsInput, AiSettingsView } from '@shared/types.ts';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Field';
import { Switch } from '@/components/ui/Switch';
import { Tag } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';

// 설정 > AI 연결. 이 PC·기관 내부망의 AI(OpenAI 호환)와 Claude API(인터넷) 중에서 고른다.

type Form = Omit<AiSettingsInput, 'apiKey'> & { apiKey: string | undefined };

interface Preset {
  key: string;
  title: string;
  description: string;
  icon: ReactNode;
  values: Partial<Form>;
}

const PRESETS: Preset[] = [
  {
    key: 'ollama',
    title: '이 PC의 Ollama',
    description: '시험용. 이 컴퓨터에 설치한 Ollama 모델',
    icon: <Server className="size-4" aria-hidden />,
    values: {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      model: 'gemma4:12b-it-qat',
      extraBody: '{"reasoning_effort": "none"}',
      vision: 'auto',
    },
  },
  {
    key: 'institution',
    title: '기관 AI 서버',
    description: '내부망의 vLLM 등 OpenAI 호환 서버',
    icon: <Server className="size-4" aria-hidden />,
    values: {
      provider: 'openai-compatible',
      baseUrl: 'http://ai-server:8000/v1',
      model: '',
      extraBody: '{"chat_template_kwargs": {"enable_thinking": false}}',
      vision: 'auto',
    },
  },
  {
    key: 'claude',
    title: 'Claude API',
    description: '인터넷 연결 필요 · 사용량만큼 요금',
    icon: <Globe className="size-4" aria-hidden />,
    values: { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', effort: 'low', vision: 'auto', extraBody: '' },
  },
  {
    key: 'other',
    title: '기타 OpenAI 호환',
    description: '주소와 모델을 직접 입력',
    icon: <Globe className="size-4" aria-hidden />,
    values: { provider: 'openai-compatible', baseUrl: '', model: '', extraBody: '', vision: 'auto' },
  },
];

const JSON_MODE_LABEL: Record<AiJsonMode, string> = {
  json_schema: 'JSON 스키마 강제',
  json_object: 'JSON 모드',
  prompt: '지시문만',
};

const EFFORT_LABEL: Record<AiEffort, string> = { low: '낮음 (빠르고 저렴, 권장)', medium: '보통', high: '높음 (느리고 비쌈)' };

function formOf(view: AiSettingsView): Form {
  const { hasApiKey: _k, externalBlocked: _b, isExternal: _e, probe: _p, ...rest } = view;
  return { ...rest, apiKey: undefined };
}

function presetOf(form: Form): string {
  if (form.provider === 'anthropic') return 'claude';
  if (/localhost:11434|127\.0\.0\.1:11434/.test(form.baseUrl)) return 'ollama';
  if (form.extraBody.includes('enable_thinking')) return 'institution';
  return 'other';
}

/** 저장할 값. API 키는 새로 넣었거나 지울 때만 보낸다 */
function bodyOf(form: Form): AiSettingsInput {
  const { apiKey, ...rest } = form;
  return apiKey === undefined ? rest : { ...rest, apiKey };
}

export function AiTab() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'ai'], queryFn: () => api.get<AiSettingsView>('/settings/ai') });
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probe, setProbe] = useState<AiProbeResult | null>(null);

  useEffect(() => {
    if (settings.data && form === null) {
      setForm(formOf(settings.data));
      setProbe(settings.data.probe);
    }
  }, [settings.data, form]);

  if (settings.isPending || !form || !settings.data) return null;
  const view = settings.data;
  const external = isExternalAi(form.provider, form.baseUrl);
  // 저장된 키는 저장할 때와 같은 서버에만 쓴다 (서버도 같은 규칙으로 버린다)
  const keyKept = view.hasApiKey && form.apiKey === undefined && sameAiTarget(form, view);
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });

  async function test() {
    setTesting(true);
    setError(null);
    try {
      setProbe(await api.post<AiProbeResult>('/settings/ai/test', bodyOf(form!)));
      await queryClient.invalidateQueries({ queryKey: ['settings', 'ai'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await api.put<AiSettingsView>('/settings/ai', bodyOf(form!));
      queryClient.setQueryData(['settings', 'ai'], saved);
      setForm(formOf(saved));
      setProbe(saved.probe);
      await queryClient.invalidateQueries({ queryKey: ['processing'] });
      toast.success(saved.enabled ? `AI 연결을 저장했습니다. 이제부터 올리는 이수증은 ${saved.model}로 읽습니다.` : 'AI 연결을 껐습니다. 규칙으로만 읽습니다.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <FormError message={error} />

        <div className="flex items-start gap-3 rounded-md border border-line bg-sheet p-4">
          <Switch checked={form.enabled} onChange={(enabled) => set({ enabled })} label="AI로 이수증 읽기" disabled={external && view.externalBlocked} />
          <div>
            <p className="text-[14px] font-semibold">AI로 이수증 읽기</p>
            <p className="text-[13px] text-ink-soft">
              끄면 규칙(항목 이름과 글자 위치)으로만 읽습니다. 켜도 직원 찾기·교육 분류·날짜 정리는 프로그램이 하고, AI는 이수증에 적힌 값을 읽는 일만 합니다. 직원 명단은 AI에 보내지 않습니다.
            </p>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-[13px] font-medium">연결할 AI</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESETS.map((p) => {
              const active = presetOf(form) === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    set({ ...p.values, apiKey: undefined });
                    setProbe(null);
                  }}
                  className={cn(
                    'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-navy bg-navy-soft' : 'border-line bg-sheet hover:border-line-strong',
                  )}
                >
                  <span className={cn('mt-0.5', active ? 'text-navy' : 'text-ink-faint')}>{p.icon}</span>
                  <span>
                    <span className="block text-[13.5px] font-semibold">{p.title}</span>
                    <span className="block text-[12.5px] text-ink-soft">{p.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="서버 주소"
            htmlFor="ai-url"
            required={form.provider === 'openai-compatible'}
            hint={form.provider === 'anthropic' ? '보통 그대로 둡니다.' : '"/v1"로 끝나는 OpenAI 호환 주소'}
          >
            <Input id="ai-url" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="http://ai-server:8000/v1" />
          </Field>
          <Field label="모델 이름" htmlFor="ai-model" required hint={form.provider === 'anthropic' ? '예: claude-opus-5-5' : '서버에 올라가 있는 모델 이름 그대로'}>
            <Input id="ai-model" value={form.model} onChange={(e) => set({ model: e.target.value })} />
          </Field>
          <Field
            label="API 키"
            htmlFor="ai-key"
            required={form.provider === 'anthropic'}
            hint={
              keyKept ? (
                <>
                  저장된 키가 있습니다. 바꿀 때만 입력하세요.{' '}
                  <button type="button" className="text-link underline" onClick={() => set({ apiKey: '' })}>
                    키 지우기
                  </button>
                </>
              ) : view.hasApiKey && !form.apiKey ? (
                '저장하면 지금 저장된 키를 지웁니다 (다른 서버로 키를 보내지 않습니다).'
              ) : form.provider === 'anthropic' ? (
                'console.anthropic.com에서 만든 키. 화면에 다시 보여 주지 않습니다.'
              ) : (
                '필요한 서버만 입력 (Ollama는 비워 둡니다)'
              )
            }
          >
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              value={form.apiKey ?? ''}
              placeholder={keyKept ? '••••••••(저장됨)' : ''}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </Field>
          <Field
            label="이미지 읽기"
            htmlFor="ai-vision"
            hint="스캔본을 AI가 이미지로 직접 읽을지. '자동'은 연결 테스트 결과를 따릅니다."
          >
            <Select id="ai-vision" value={form.vision} onChange={(e) => set({ vision: e.target.value as Form['vision'] })}>
              <option value="auto">자동 (연결 테스트로 정함)</option>
              <option value="on">켬 — 스캔 이미지를 AI에 보냄</option>
              <option value="off">끔 — OCR 글자만 AI에 보냄</option>
            </Select>
          </Field>
          {form.provider === 'anthropic' ? (
            <Field label="생각 수준(effort)" htmlFor="ai-effort" hint="이수증 읽기는 '낮음'으로 충분합니다.">
              <Select id="ai-effort" value={form.effort} onChange={(e) => set({ effort: e.target.value as AiEffort })}>
                {(Object.keys(EFFORT_LABEL) as AiEffort[]).map((k) => (
                  <option key={k} value={k}>
                    {EFFORT_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field
              label="추가 파라미터 (JSON)"
              htmlFor="ai-extra"
              className="sm:col-span-2"
              hint={
                <>
                  요청에 그대로 더해 보냅니다. 생각 과정(thinking)을 끄는 값이 보통 필요합니다 — Ollama:{' '}
                  <code>{'{"reasoning_effort": "none"}'}</code>, vLLM+Qwen: <code>{'{"chat_template_kwargs": {"enable_thinking": false}}'}</code>. 빼고 싶은 기본값은 null로 (예: <code>{'{"temperature": null}'}</code>).
                </>
              }
            >
              <Textarea id="ai-extra" className="min-h-14 font-mono text-[13px]" value={form.extraBody} onChange={(e) => set({ extraBody: e.target.value })} />
            </Field>
          )}
          <Field label="동시 처리 수" htmlFor="ai-concurrency" hint="AI 서버가 여러 요청을 함께 받을 수 있을 때만 늘립니다 (1~8).">
            <Input
              id="ai-concurrency"
              type="number"
              min={1}
              max={8}
              value={form.concurrency}
              onChange={(e) => set({ concurrency: Number(e.target.value) })}
            />
          </Field>
          <Field label="제한 시간(초)" htmlFor="ai-timeout" hint="한 쪽을 이 시간 안에 못 읽으면 다시 시도합니다.">
            <Input
              id="ai-timeout"
              type="number"
              min={10}
              max={600}
              value={form.timeoutSeconds}
              onChange={(e) => set({ timeoutSeconds: Number(e.target.value) })}
            />
          </Field>
        </div>

        {external && (
          <div className={cn('rounded-md border p-4', view.externalBlocked ? 'border-seal/30 bg-seal-soft' : 'border-warn/30 bg-warn-soft')}>
            <p className={cn('flex items-center gap-2 text-[14px] font-semibold', view.externalBlocked ? 'text-seal' : 'text-warn')}>
              <ShieldAlert className="size-4" aria-hidden />
              기관 밖(인터넷)의 AI 서버입니다
            </p>
            {view.externalBlocked ? (
              <p className="mt-1 text-[13px] text-ink-soft">
                이 설치본은 외부 AI를 쓸 수 없게 설정되어 있습니다 (config.json의 <code>allowExternalAi: false</code>). 기관 내부망의 AI 서버를 고르세요.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-ink-soft">
                  AI로 읽을 때 이수증 이미지와 글자(성명·생년월일·소속 포함)가 이 서버로 전송됩니다. 기관의 개인정보 처리 지침과 보안성 검토를 확인한 뒤 사용하세요. 연결 테스트는 가상 이수증만 보냅니다.
                </p>
                <label className="mt-3 flex items-center gap-2 text-[13.5px] font-medium">
                  <input type="checkbox" checked={form.allowExternal} onChange={(e) => set({ allowExternal: e.target.checked })} className="size-4" />
                  외부 AI로 이수증을 보내는 것을 허용합니다
                </label>
              </>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="button" onClick={() => void test()} loading={testing} disabled={external && view.externalBlocked}>
            연결 테스트
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            저장
          </Button>
        </div>
      </div>

      <aside className="space-y-3 self-start lg:sticky lg:top-6">
        <div className="rounded-md border border-line bg-sheet p-4">
          <p className="text-[12.5px] font-medium text-ink-faint">지금 쓰는 연결</p>
          <p className="mt-1 text-[14px] font-semibold">{view.enabled ? view.model : '꺼짐 — 규칙으로만 읽음'}</p>
          {view.enabled && (
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-soft">
              {view.provider === 'anthropic' ? 'Claude API' : view.baseUrl}
              <Tag tone={view.isExternal ? 'warn' : 'ok'}>{view.isExternal ? '기관 밖' : '기관 안'}</Tag>
            </p>
          )}
        </div>
        <ProbePanel probe={probe} testing={testing} />
      </aside>
    </form>
  );
}

function ProbePanel({ probe, testing }: { probe: AiProbeResult | null; testing: boolean }) {
  if (testing) {
    return (
      <div className="rounded-md border border-line bg-sheet p-4 text-[13px] text-ink-soft">
        가상 이수증(윤하늘, 4대폭력 통합교육)을 보내 글자 읽기와 이미지 읽기를 시험하는 중입니다. 모델이 처음 올라오는 중이면 1분 넘게 걸릴 수 있습니다.
      </div>
    );
  }
  if (!probe) {
    return (
      <div className="rounded-md border border-dashed border-line-strong p-4 text-[13px] text-ink-faint">
        "연결 테스트"를 누르면 가상 이수증으로 AI가 제대로 읽는지, 이미지를 읽을 수 있는지, 얼마나 걸리는지 확인합니다.
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-md border border-line bg-sheet p-4">
      <p className={cn('flex items-center gap-2 text-[14px] font-semibold', probe.ok ? 'text-ok' : 'text-seal')}>
        {probe.ok ? <CircleCheck className="size-4" aria-hidden /> : <CircleX className="size-4" aria-hidden />}
        {probe.ok ? '연결 테스트 통과' : '연결 테스트 실패'}
      </p>
      {probe.error && <p className="text-[13px] text-seal">{probe.error}</p>}
      {probe.ok && (
        <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-[13px]">
          <dt className="text-ink-faint">답 형식</dt>
          <dd>{probe.jsonMode ? JSON_MODE_LABEL[probe.jsonMode] : '-'}</dd>
          <dt className="text-ink-faint">이미지 읽기</dt>
          <dd>{probe.vision === true ? '가능' : probe.vision === false ? '안 됨 (OCR 글자로 읽음)' : '확인 안 함'}</dd>
          <dt className="text-ink-faint">걸린 시간</dt>
          <dd>{probe.latencyMs !== null ? `${(probe.latencyMs / 1000).toFixed(1)}초 (글자 읽기 1쪽)` : '-'}</dd>
          <dt className="text-ink-faint">읽은 값</dt>
          <dd>
            {probe.sample?.personName ?? '(이름 없음)'} · {probe.sample?.completionDate ?? '(날짜 없음)'}
            <br />
            <span className="text-ink-soft">{probe.sample?.courseTitle}</span>
          </dd>
        </dl>
      )}
      {probe.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-soft">
          {probe.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <p className="text-[12px] text-ink-faint">{new Date(probe.testedAt).toLocaleString('ko-KR')}</p>
    </div>
  );
}
