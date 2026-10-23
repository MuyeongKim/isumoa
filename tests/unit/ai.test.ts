import { describe, expect, it } from 'vitest';
import { isInternalUrl, sameAiTarget } from '../../shared/aiHosts.ts';
import { AiHealth } from '../../server/src/ai/health.ts';
import { extractJson, firstJsonObject } from '../../server/src/ai/json.ts';
import { ExtractedCertificate } from '../../server/src/ai/schema.ts';
import { fromInput, DEFAULT_AI_SETTINGS } from '../../server/src/ai/settings.ts';
import { withNotes } from '../../server/src/certs/flags.ts';
import { normalizeAi } from '../../server/src/certs/normalize.ts';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import type { Training } from '../../shared/types.ts';
import type { MatchableEmployee } from '../../server/src/certs/employeeMatcher.ts';
import { buildDrafts } from '../../server/src/certs/processPage.ts';
import { mergeWithRules, type Recognition } from '../../server/src/certs/recognize.ts';

describe('AI 답에서 JSON 꺼내기', () => {
  it('생각 과정과 코드 울타리, 앞뒤 설명을 걷어 낸다', () => {
    expect(extractJson('<think>이름은 홍길동 {같은}</think>\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('여기 결과입니다: {"a": {"b": "}"}} 끝')).toEqual({ a: { b: '}' } });
    expect(extractJson('생각...</think>{"a": 2}')).toEqual({ a: 2 });
  });

  it('잘린 답은 JSON을 찾지 못했다고 알린다', () => {
    expect(firstJsonObject('{"a": [1, 2')).toBeNull();
    expect(() => extractJson('{"a": [1, 2')).toThrow('JSON을 찾지 못했습니다');
  });
});

describe('기관 안팎 주소 구분', () => {
  it('localhost·사설 IP·점 없는 이름·내부 도메인은 기관 안으로 본다', () => {
    for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:8000/v1', 'http://10.1.2.3/v1', 'http://172.20.0.5/v1', 'http://192.168.0.10:8000/v1', 'http://ai-server:8000/v1', 'http://llm.corp/v1', 'http://[::1]:8000/v1']) {
      expect(isInternalUrl(url), url).toBe(true);
    }
  });

  it('공인 주소와 인터넷 도메인은 기관 밖으로 본다', () => {
    for (const url of ['https://api.openai.com/v1', 'http://8.8.8.8/v1', 'http://172.32.0.1/v1', 'https://api.anthropic.com', 'not a url']) {
      expect(isInternalUrl(url), url).toBe(false);
    }
  });

  it('서버가 바뀌면 저장된 API 키를 버린다', () => {
    const current = { ...DEFAULT_AI_SETTINGS, baseUrl: 'http://ai-server:8000/v1', apiKey: 'secret' };
    const { apiKey: _k, probe: _p, ...input } = current;
    expect(sameAiTarget(current, { ...current, baseUrl: 'http://ai-server:8000/v1/' })).toBe(true);
    expect(fromInput(input, current, null).apiKey).toBe('secret');
    expect(fromInput({ ...input, baseUrl: 'https://other.example.com/v1' }, current, null).apiKey).toBeNull();
    expect(fromInput({ ...input, provider: 'anthropic' }, current, null).apiKey).toBeNull();
    expect(fromInput({ ...input, apiKey: '' }, current, null).apiKey).toBeNull();
  });
});

describe('AI 값 정리', () => {
  const ai = (fields: Record<string, unknown>) => normalizeAi(ExtractedCertificate.parse({ trainingCodes: [], ...fields }));

  it('날짜·시간·번호·기관명을 규칙 판독과 같은 모양으로 바꾼다', () => {
    expect(
      ai({
        personName: '홍 길 동',
        birthDate: '1990. 7. 15.',
        completionDate: '2026. 3. 2. ~ 2026. 3. 31.',
        hours: '4',
        certificateNo: '제 2026-0417 호',
        provider: '가상인재개발원장',
      }),
    ).toMatchObject({
      personName: '홍길동',
      personBirth: '1990-07-15',
      completedOn: '2026-03-31',
      hours: 4,
      certNo: '2026-0417',
      provider: '가상인재개발원',
    });
    expect(ai({ completionDate: null, periodEnd: '2026.05.20', hours: '2차시' })).toMatchObject({
      completedOn: '2026-05-20',
      hours: null,
      hoursText: '2차시',
      hoursInSessions: true,
    });
    expect(ai({ hours: '1시간 30분' }).hours).toBe(1.5);
  });

  it('빠진 칸이나 숫자로 온 칸도 받아 준다', () => {
    const parsed = ExtractedCertificate.parse({ personName: '김하나', hours: 2 });
    expect(parsed).toMatchObject({ personName: '김하나', hours: '2', courseTitle: null, trainingCodes: [] });
  });
});

describe('AI 값과 규칙 값 합치기', () => {
  const text = '수 료 증\n성 명 : 박가온\n과 정 명 : 2026년 청렴교육\n교육일자 : 2026. 5. 20.\n교육시간 : 2시간';
  const rules = parseCertificateText(text);
  const ai = (fields: Record<string, unknown>) => normalizeAi(ExtractedCertificate.parse({ trainingCodes: [], ...fields }));

  it('PDF 글자층에 없는 이름은 지어낸 값으로 보고 규칙 값을 쓰되, 다르게 읽었다고 남긴다', () => {
    const merged = mergeWithRules(ai({ personName: '박가은', completionDate: '2026-05-20', hours: '2시간' }), [], rules, text, 'pdf');
    expect(merged.personName).toBe('박가온');
    expect(merged.differences).toEqual([{ field: 'name', ai: '박가은', rules: '박가온' }]);
  });

  it('스캔본에서는 AI 값을 먼저 쓰고, AI가 비운 칸은 규칙 값으로 채운다', () => {
    const merged = mergeWithRules(ai({ personName: '박가은', courseTitle: null }), ['integrity'], rules, text, 'ocr');
    expect(merged).toMatchObject({ personName: '박가은', courseTitle: '2026년 청렴교육', completedOn: '2026-05-20', hours: 2, source: 'ai', aiCodes: ['integrity'] });
  });

  it('같게 읽었으면 확인할 점을 남기지 않는다', () => {
    const merged = mergeWithRules(ai({ personName: '박가온', completionDate: '2026.5.20', hours: '2시간' }), [], rules, text, 'pdf');
    expect(merged.differences).toEqual([]);
  });
});

describe('AI와 OCR이 이름을 다르게 읽었을 때', () => {
  const employee = (id: number, name: string): MatchableEmployee => ({
    id,
    name,
    nameKey: name,
    empNo: String(id),
    departmentId: 1,
    departmentName: '재무과',
    birthDate: null,
    status: 'active',
  });
  const ocrText = '교육 이수증\n이름 가사\n교육과정 2026년 공직자 청렴교육\n이수일자 2026-05-20';
  const draftFor = (aiName: string, employees: MatchableEmployee[]) => {
    const fields = normalizeAi(ExtractedCertificate.parse({ personName: aiName, courseTitle: '2026년 공직자 청렴교육', completionDate: '2026-05-20' }));
    const rc = mergeWithRules(fields, [], parseCertificateText(ocrText), ocrText, 'ocr');
    const recognition: Recognition = { route: 'ai-vision', text: ocrText, certificates: [rc], ai: null };
    const trainings: Training[] = [];
    return buildDrafts(recognition, { trainings, employees, learned: new Map(), scope: null, year: 2026 })[0];
  };

  it('AI 이름이 명단과 정확히 맞고 비슷한 이름의 직원이 없으면 안내로만 남긴다', () => {
    const draft = draftFor('송주주', [employee(1, '송주주'), employee(2, '김하나')]);
    expect(draft.match.employeeId).toBe(1);
    expect(draft.notes.map((n) => [n.code, n.level])).toEqual([['ocr-name', 'info']]);
  });

  it('비슷한 이름의 직원이 있으면 경고로 원본 대조를 요청한다', () => {
    const draft = draftFor('송주주', [employee(1, '송주주'), employee(2, '송주호')]);
    expect(draft.notes.map((n) => [n.code, n.level])).toEqual([['ai-differs', 'warning']]);
  });

  it('AI 이름이 명단에 없으면 경고로 남긴다', () => {
    const draft = draftFor('송주추', [employee(1, '송주주')]);
    expect(draft.notes.map((n) => n.code)).toContain('ai-differs');
  });
});

describe('확인할 점 합치기와 AI 상태', () => {
  it('같은 종류는 한 번만, 오류 → 경고 → 안내 순서로', () => {
    const merged = withNotes(
      [
        { code: 'ocr', level: 'info', message: 'a' },
        { code: 'no-date', level: 'error', message: 'b' },
      ],
      [
        { code: 'ai-differs', level: 'warning', message: 'c' },
        { code: 'ocr', level: 'info', message: 'd' },
      ],
    );
    expect(merged.map((f) => f.code)).toEqual(['no-date', 'ai-differs', 'ocr']);
  });

  it('연결 실패가 이어지면 2분 동안 쉬고, 성공하면 다시 정상', () => {
    const health = new AiHealth();
    health.recordFailure('연결 안 됨');
    expect(health.resting()).toBe(false);
    health.recordFailure('연결 안 됨');
    expect(health.resting()).toBe(true);
    expect(health.resting(Date.now() + 3 * 60_000)).toBe(false);
    health.recordSuccess();
    expect(health.error()).toBeNull();
  });
});
