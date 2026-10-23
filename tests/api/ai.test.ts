import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AiProbeResult, AiSettingsInput, AiSettingsView, BulkConfirmResult, CertificateListItem, ProcessingStatus } from '../../shared/types.ts';
import { certificateJson, chat, claudeMessage, hasImage, startFakeOpenAi, userText, type FakeAi } from '../fakes/fakeOpenAi.ts';
import { createHarness, PDF, type Harness } from './harness.ts';

// AI 연결: 설정·연결 테스트·쪽 처리·장애 때 규칙으로 돌아가기·일괄 확정을 가짜 AI 서버로 확인한다.

let h: Harness;
let fake: FakeAi;
let batchId: number;
let fileSeq = 0;

const TEXT = [
  '수 료 증',
  '성 명 : 오호영',
  '소 속 : 가람시 총무과',
  '과 정 명 : 2026년 공직자 청렴교육',
  '교육일자 : 2026. 5. 20.',
  '교육시간 : 2시간',
  '위 사람은 위 교육과정을 이수하였음을 증명합니다.',
  '가상청렴연수원장',
].join('\n');

function settings(patch: Partial<AiSettingsInput> = {}): AiSettingsInput {
  return {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: fake.url,
    model: 'fake-model',
    vision: 'auto',
    concurrency: 1,
    timeoutSeconds: 10,
    extraBody: '',
    effort: 'low',
    allowExternal: false,
    ...patch,
  };
}

/** 쪽 하나를 올려 처리하고, 그 쪽에서 나온 이수증을 돌려준다 */
async function process(text: string): Promise<CertificateListItem[]> {
  const file = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from(`ai-${++fileSeq}`)]), `${fileSeq}.pdf`)).json();
  const pageId = await h.uploadPage(file.fileId, 1, text);
  await h.drainQueue();
  const list = (await h.send('GET', `/api/certificates?batchId=${batchId}`)).json() as CertificateListItem[];
  return list.filter((c) => c.pageId === pageId);
}

beforeAll(async () => {
  h = await createHarness();
  fake = await startFakeOpenAi();
  const dept = await h.db.insertInto('departments').values({ name: '총무과' }).returning('id').executeTakeFirstOrThrow();
  await h.db
    .insertInto('employees')
    .values([
      { name: '오호영', name_key: '오호영', department_id: dept.id, birth_date: '1981-10-22', emp_no: '1001' },
      { name: '송주주', name_key: '송주주', department_id: dept.id, birth_date: '1974-08-25', emp_no: '1002' },
    ])
    .execute();
  batchId = (await h.send('POST', '/api/batches', { year: 2026 })).json().id;
});

afterAll(async () => {
  await fake.close();
  await h.close();
});

beforeEach(() => {
  fake.requests.length = 0;
  h.aiHealth.reset();
});

describe('AI 연결 설정', () => {
  it('연결 테스트는 가상 이수증을 보내 JSON 모드와 이미지 읽기를 확인한다', async () => {
    fake.respond = (req) =>
      req.body.response_format?.type === 'json_schema'
        ? { status: 400, json: { error: { message: 'response_format json_schema is not supported' } } }
        : chat(`결과입니다\n${certificateJson({ personName: '윤하늘', courseTitle: '2026년 4대폭력 예방 통합교육', completionDate: '2026년 3월 31일', hours: '4시간' })}`);
    const res = await h.send('POST', '/api/settings/ai/test', settings({ apiKey: 'sk-local-123' }));
    expect(res.statusCode).toBe(200);
    const probe = res.json() as AiProbeResult;
    expect(probe).toMatchObject({ ok: true, jsonMode: 'json_object', vision: true, error: null });
    expect(probe.sample).toEqual({ personName: '윤하늘', courseTitle: '2026년 4대폭력 예방 통합교육', completionDate: '2026-03-31' });
    // json_schema 시도(400) → json_object 글자 → json_object 이미지
    expect(fake.requests.map((r) => r.body.response_format?.type)).toEqual(['json_schema', 'json_object', 'json_object']);
    expect(hasImage(fake.requests[2])).toBe(true);
    expect(userText(fake.requests[1])).toContain('윤하늘');
  });

  it('저장하면 같은 연결로 해 본 테스트 결과를 함께 저장하고, API 키는 화면에 돌려주지 않는다', async () => {
    const res = await h.send('PUT', '/api/settings/ai', settings({ apiKey: 'sk-local-123' }));
    expect(res.statusCode).toBe(200);
    const view = res.json() as AiSettingsView;
    expect(view).toMatchObject({ enabled: true, hasApiKey: true, isExternal: false, probe: { jsonMode: 'json_object', vision: true } });
    expect(JSON.stringify(view)).not.toContain('sk-local-123');
  });

  it('기관 밖 서버는 "외부 AI 허용"을 켜야 저장되고, 설치본에서 막았으면 아예 쓸 수 없다', async () => {
    const outside = settings({ baseUrl: 'https://api.example.com/v1' });
    const blocked = await h.send('PUT', '/api/settings/ai', outside);
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.message).toContain('외부 AI 사용 허용');
    expect(fake.requests).toHaveLength(0);

    const claude = await h.send('PUT', '/api/settings/ai', settings({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', allowExternal: true }));
    expect(claude.statusCode).toBe(400); // 키 없음
    expect(claude.json().error.message).toContain('API 키');

    const locked = await createHarness({ allowExternalAi: false });
    try {
      const res = await locked.send('POST', '/api/settings/ai/test', { ...outside, allowExternal: true });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.message).toContain('allowExternalAi');
    } finally {
      await locked.close();
    }
  });

  it('저장된 API 키를 다른 서버로 보내지 않는다', async () => {
    const other = await startFakeOpenAi();
    try {
      other.respond = () => chat(certificateJson({ personName: '윤하늘', completionDate: '2026-03-31' }));
      await h.send('POST', '/api/settings/ai/test', settings({ baseUrl: other.url, vision: 'off' }));
      expect(other.requests.length).toBeGreaterThan(0);
      expect(other.requests.every((r) => r.headers.authorization === undefined)).toBe(true);
    } finally {
      await other.close();
    }
    // 원래 서버로는 키를 보낸다
    fake.respond = () => chat(certificateJson({ personName: '윤하늘', completionDate: '2026-03-31' }));
    await h.send('POST', '/api/settings/ai/test', settings({ vision: 'off' }));
    expect(fake.requests[0].headers.authorization).toBe('Bearer sk-local-123');
  });
});

describe('AI로 쪽 처리', () => {
  it('PDF 글자를 AI에 보내 읽고, 직원·교육은 프로그램이 정한다', async () => {
    fake.respond = () =>
      chat(certificateJson({ personName: '오호영', department: '가람시 총무과', courseTitle: '2026년 공직자 청렴교육', completionDate: '2026. 5. 20.', hours: '2시간', trainingCodes: ['integrity'] }));
    const [cert] = await process(TEXT);
    expect(cert).toMatchObject({ route: 'ai-text', personName: '오호영', completedOn: '2026-05-20', hours: 2 });
    expect(cert.employee?.name).toBe('오호영');
    expect(cert.flags.filter((f) => f.level !== 'info')).toEqual([]);
    // 직원 명단은 AI에 보내지 않는다
    expect(userText(fake.requests[0])).not.toContain('송주주');
    expect(hasImage(fake.requests[0])).toBe(false);
  });

  it('과정명으로 정한 교육과 AI가 고른 교육이 다르면 확인 표시를 단다', async () => {
    fake.respond = () => chat(certificateJson({ personName: '오호영', courseTitle: '2026년 공직자 청렴교육', completionDate: '2026-05-20', hours: '2시간', trainingCodes: ['privacy'] }));
    const [cert] = await process(TEXT.replace('2시간', '2 시간'));
    expect(cert.flags.map((f) => f.code)).toContain('training-conflict');
  });

  it('스캔본은 이미지를 읽는 모델이면 이미지를 보내고, 한 쪽의 여러 장을 각각 만든다', async () => {
    h.ocr.text = '수 료 증\n성 명 오호영\n교육명 2026 청렴교육';
    fake.respond = () =>
      chat(
        certificateJson(
          { personName: '오호영', courseTitle: '2026년 공직자 청렴교육', completionDate: '2026-06-01', hours: '2시간', trainingCodes: ['integrity'] },
          { more: [{ personName: '송주주', courseTitle: '2026년 공직자 청렴교육', completionDate: '2026-06-02', hours: '2시간', trainingCodes: ['integrity'] }] },
        ),
      );
    const certs = await process('');
    expect(hasImage(fake.requests[0])).toBe(true);
    expect(certs.map((c) => [c.route, c.employee?.name, c.completedOn])).toEqual([
      ['ai-vision', '오호영', '2026-06-01'],
      ['ai-vision', '송주주', '2026-06-02'],
    ]);
    expect(certs[0].flags.map((f) => f.code)).toEqual(expect.arrayContaining(['ai-vision', 'multi-certificate']));
  });

  it('AI가 JSON이 아닌 답을 하면 한 번 더 묻고, 그래도 안 되면 규칙으로 읽는다', async () => {
    let calls = 0;
    fake.respond = () => (++calls === 1 ? chat('죄송합니다, 읽을 수 없습니다.') : chat(certificateJson({ personName: '오호영', completionDate: '2026-05-20', hours: '2시간', courseTitle: '2026년 공직자 청렴교육' })));
    const [ok] = await process(TEXT.replace('교육시간', '교육 시간'));
    expect(calls).toBe(2);
    expect(userText(fake.requests[1])).toContain('앞의 답은 쓸 수 없었습니다');
    expect(ok.route).toBe('ai-text');

    fake.respond = () => chat('그냥 글자');
    const [fallback] = await process(TEXT.replace('수 료 증', '수료증'));
    expect(fallback).toMatchObject({ route: 'text', personName: '오호영' });
    expect(fallback.flags.map((f) => f.code)).toContain('ai-failed');
    const page = await h.db.selectFrom('pages').select(['ai_raw', 'ai_error']).where('id', '=', fallback.pageId).executeTakeFirstOrThrow();
    expect(page.ai_raw).toContain('그냥 글자');
    expect(page.ai_error).toContain('JSON');
  });

  it('AI 서버가 멈추면 대기열이 다시 시도하고, 마지막에는 규칙으로 읽어 안내줄에 알린다', async () => {
    fake.respond = () => ({ status: 503, json: { error: { message: 'model is loading' } } });
    const file = (await h.uploadFile(batchId, Buffer.concat([PDF, Buffer.from('down')]), 'down.pdf')).json();
    const pageId = await h.uploadPage(file.fileId, 1, TEXT);

    const errors = await h.drainQueue();
    expect(errors[0]).toContain('503');
    expect((await h.send('GET', '/api/processing')).json() as ProcessingStatus).toMatchObject({ waiting: 1, aiError: expect.stringContaining('503') });

    // 1분 뒤 마지막 시도라고 치고 바로 처리한다
    await h.db.updateTable('jobs').set({ run_after: new Date(0).toISOString(), attempts: 2 }).where('page_id', '=', pageId).execute();
    expect(await h.drainQueue()).toEqual([]);
    const [cert] = ((await h.send('GET', `/api/certificates?batchId=${batchId}`)).json() as CertificateListItem[]).filter((c) => c.pageId === pageId);
    expect(cert).toMatchObject({ route: 'text', personName: '오호영' });
    expect(cert.flags.find((f) => f.code === 'ai-failed')?.message).toContain('503');
  });
});

describe('Claude API 연결 (가짜 서버로 요청 모양 확인)', () => {
  it('공식 SDK로 구조화된 답·생각 수준·서버 측 대체를 요청하고, 이미지는 base64로 보낸다', async () => {
    const claude = await startFakeOpenAi();
    try {
      claude.respond = () => claudeMessage(certificateJson({ personName: '윤하늘', courseTitle: '2026년 4대폭력 예방 통합교육', completionDate: '2026-03-31', hours: '4시간' }));
      const body = settings({ provider: 'anthropic', baseUrl: claude.origin, model: 'claude-opus-5-5', apiKey: 'sk-ant-test', allowExternal: true });
      const probe = (await h.send('POST', '/api/settings/ai/test', body)).json() as AiProbeResult;
      expect(probe).toMatchObject({ ok: true, jsonMode: 'json_schema', vision: true });

      const [text, image] = claude.requests;
      expect(text.path).toBe('/v1/messages');
      expect(text.headers.authorization).toBe('Bearer sk-ant-test');
      expect(text.headers['anthropic-beta']).toContain('server-side-fallback-2026-07-01');
      expect(text.body).toMatchObject({
        model: 'claude-opus-5-5',
        fallbacks: 'default',
        output_config: { effort: 'low', format: { type: 'json_schema' } },
      });
      expect(text.body.temperature).toBeUndefined();
      expect(hasImage(image)).toBe(true);

      // 거절하면 규칙으로 읽는다
      claude.respond = () => claudeMessage('', 'refusal');
      expect((await h.send('PUT', '/api/settings/ai', body)).statusCode).toBe(200);
      const [cert] = await process(TEXT.replace('수 료 증', '수   료   증'));
      expect(cert.route).toBe('text');
      expect(cert.flags.find((f) => f.code === 'ai-failed')?.message).toContain('거절');
    } finally {
      await claude.close();
      await h.send('PUT', '/api/settings/ai', settings({ apiKey: 'sk-local-123' }));
    }
  });
});

describe('정상 n건 일괄 확정', () => {
  it('확인할 점이 없는 이수증만 확정하고 나머지는 이유와 함께 남긴다', async () => {
    const drafts = ((await h.send('GET', `/api/certificates?batchId=${batchId}&status=draft`)).json() as CertificateListItem[]);
    const clean = drafts.filter((c) => c.flags.every((f) => f.level === 'info'));
    const flagged = drafts.find((c) => c.flags.some((f) => f.level === 'warning'))!;
    expect(clean.length).toBeGreaterThan(0);

    // 다시 읽는 중인 쪽의 이수증은 곧 바뀌므로 확정하지 않는다
    const page = clean[0].pageId;
    await h.db.updateTable('pages').set({ state: 'queued' }).where('id', '=', page).execute();
    expect(((await h.send('GET', `/api/certificates/${clean[0].id}`)).json() as CertificateListItem).reading).toBe(true);
    const waiting = (await h.send('POST', '/api/certificates/bulk-confirm', { ids: [clean[0].id] })).json() as BulkConfirmResult;
    expect(waiting).toEqual({ confirmed: 0, skipped: [{ id: clean[0].id, reason: '원본 쪽을 다시 읽는 중입니다.' }] });
    await h.db.updateTable('pages').set({ state: 'done' }).where('id', '=', page).execute();

    const res = await h.send('POST', '/api/certificates/bulk-confirm', { ids: [...clean.map((c) => c.id), flagged.id] });
    const result = res.json() as BulkConfirmResult;
    expect(result.confirmed).toBe(clean.length);
    expect(result.skipped).toEqual([{ id: flagged.id, reason: flagged.flags.find((f) => f.level !== 'info')!.message }]);

    const after = (await h.send('GET', `/api/certificates?batchId=${batchId}&status=confirmed`)).json() as CertificateListItem[];
    expect(after.map((c) => c.id).sort()).toEqual(clean.map((c) => c.id).sort());
    // 과정명 → 교육 매핑도 기억한다
    expect(await h.db.selectFrom('course_mappings').selectAll().execute()).not.toHaveLength(0);
  });
});
