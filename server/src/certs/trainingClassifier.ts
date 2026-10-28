// 과정명으로 어떤 법정교육인지 정한다.
// ① 서무가 확정하면서 쌓인 "과정명 → 교육" 매핑 → ② 교육별 인식 키워드 순서로 본다.
// 통합과정(예: 4대폭력)은 여러 교육에 같은 키워드가 들어 있어 한 장으로 여러 교육이 정해진다.

export interface ClassifiableTraining {
  id: number;
  name: string;
  keywords: string[];
  /** 사용 중이고 그해에 적용되는 교육 */
  applicable: boolean;
}

export interface Classification {
  trainingIds: number[];
  source: 'learned' | 'keyword' | 'text' | 'name' | null;
  /** 키워드는 맞지만 사용하지 않는 교육 */
  inactiveMatches: string[];
  ignoredKeywords?: string[];
  scopeConflicts?: string[];
}

function squeeze(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/** 매핑 열쇠: 연도("2026년")·띄어쓰기·문장부호를 빼서 해마다 같은 과정이 같은 열쇠가 되게 한다 */
export function courseTitleKey(title: string): string {
  return title
    .normalize('NFC')
    .replace(/\[\s*(?:19|20)\d{2}\s*년?\s*[-–]?\s*\d+\s*기\s*\]/g, '')
    .replace(/\[\s*(?:mobile|모바일)\s*겸용\s*\]/gi, '')
    .replace(/\(\s*(?:19|20)\d{2}\s*년?\s*(?:개발|제작|개정)\s*\)/g, '')
    .replace(/^\s*\d+\s*기(?=\s)/, '')
    .replace(/(19|20)\d{2}\s*년?\s*(도)?/g, '')
    .replace(/[\s·ㆍ.,()[\]{}<>「」『』"'‘’“”:;\-_/|~!?]/g, '')
    .toLowerCase()
    .replace(/^제\d+기/, '')
    .replace(/^(?:mobile|모바일)겸용/, '');
}

const GENERIC_NAMES = new Set(['법정', '의무', '기본', '일반', '정기', '직무', '실무', '예방', '안전', '소방', '교육과정']);
const GENERIC_KEYWORDS = new Set([...GENERIC_NAMES, '긴급', '복지', '지원', '신고', '교육', '정보', '제도', '인식', '개선', '공공', '공무원', '공직자', '기초', '특강']);

/** 표현만 다른 같은 주제는 이어 읽되, "긴급" 같은 공통 낱말만으로 다른 분야를 연결하지 않는다. */
function semanticText(text: string): string {
  return squeeze(text).replace(/[·ㆍ.,()[\]{}<>「」『』"'‘’“”:;\-_/|~!?]/g, '')
    .replace(/긴급복지지원/g, '긴급복지').replace(/장애인인식/g, '장애인식');
}

/** 공식 과정목록과 실제 수료증에서 확인한 서로 다른 주제. 통합과정은 제목에 양쪽 주제가 있으면 허용한다.
 * 근거·확인 범위: docs/research/nhi-course-rules-2026-10-27.json (법정 인정 여부를 결정하는 규칙은 아님).
 */
export function trainingScopeConflict(courseTitle: string | null, training: { name: string }): string | null {
  if (!courseTitle) return null;
  const title = semanticText(courseTitle);
  const target = semanticText(training.name);
  if (/정보공개/.test(target) && /정보보안|사이버보안|네트워크.*보안/.test(title) && !/정보공개/.test(title)) {
    return `정보보안 과정이 '${training.name}'에 연결되어 있습니다. 정보공개 과정인지 원본과 교육 내용을 확인해 주세요.`;
  }
  if (/긴급복지/.test(target) && /긴급자동차|교통안전/.test(title) && !/긴급복지/.test(title)) {
    return `교통안전 과정이 '${training.name}'에 연결되어 있습니다. 긴급복지 신고의무 교육인지 확인해 주세요.`;
  }
  return null;
}

/** 교육명으로만 추정한 후보는 반드시 확인 표시를 남긴다. 키워드·확정 매핑이 없을 때만 사용한다. */
function nameCandidate(courseTitle: string, trainings: ClassifiableTraining[]): number[] {
  const title = courseTitleKey(courseTitle);
  const matches = trainings.filter(t => {
    if (!t.applicable) return false;
    const core = courseTitleKey(t.name.replace(/\([^)]*\)/g, '')).replace(/교육$/, '').replace(/^\d+대/, '');
    return core.length >= 2 && !GENERIC_NAMES.has(core) && title.includes(core);
  });
  if (matches.length) return matches.length === 1 ? [matches[0].id] : [];
  // 명시적으로 "생명지킴이교육"이 붙은 동일 강좌명과 비교한 별칭. 인정 여부는 사람이 확인한다.
  const aliases = trainings.filter(t => t.applicable && /보고듣고말하기/.test(title) && /자살예방|생명지킴이/.test(courseTitleKey(t.name)));
  return aliases.length === 1 ? [aliases[0].id] : [];
}

export function classifyTrainings(
  courseTitle: string | null,
  fullText: string,
  trainings: ClassifiableTraining[],
  learned: Map<string, number[]>,
): Classification {
  const scopeConflicts: string[] = [];
  const compatible = (id: number) => {
    const training = trainings.find(t => t.id === id);
    const conflict = training && trainingScopeConflict(courseTitle, training);
    if (conflict && !scopeConflicts.includes(conflict)) scopeConflicts.push(conflict);
    return !conflict;
  };
  const applicableIds = new Set(trainings.filter((t) => t.applicable).map((t) => t.id));
  if (courseTitle) {
    const key = courseTitleKey(courseTitle);
    let mapped = (learned.get(key) ?? []).filter((id) => applicableIds.has(id));
    // 예전에 기수·모바일 표기까지 포함해 저장한 매핑도, 인정 교육이 일치할 때만 이어 쓴다.
    if (mapped.length === 0) {
      const legacy = [...learned].filter(([old]) => courseTitleKey(old) === key)
        .map(([, ids]) => [...new Set(ids.filter(id => applicableIds.has(id)))])
        .filter(ids => ids.length > 0);
      const variants = new Set(legacy.map(ids => [...ids].sort((a, b) => a - b).join(',')));
      if (variants.size === 1) mapped = legacy[0];
    }
    mapped = mapped.filter(compatible);
    if (mapped.length > 0) return { trainingIds: mapped, source: 'learned', inactiveMatches: [], ...(scopeConflicts.length ? { scopeConflicts } : {}) };
  }

  // 과정명을 못 읽었으면 글 전체에서 찾는다 (정확도가 떨어져 확인 표시가 붙는다)
  const haystack = semanticText(courseTitle ?? fullText);
  const ignoredKeywords = [...new Set(trainings.filter(t => t.applicable).flatMap(t => t.keywords)
    .filter(k => GENERIC_KEYWORDS.has(semanticText(k)) && haystack.includes(semanticText(k))))];
  const hits = trainings.filter((t) => t.keywords.some(k => {
    const word = semanticText(k);
    return word !== '' && !GENERIC_KEYWORDS.has(word) && haystack.includes(word);
  }));
  const trainingIds = hits.filter((t) => t.applicable && compatible(t.id)).map((t) => t.id);
  if (trainingIds.length === 0 && courseTitle) {
    const suggested = nameCandidate(courseTitle, trainings).filter(compatible);
    if (suggested.length) return { trainingIds: suggested, source: 'name', inactiveMatches: [], ...(scopeConflicts.length ? { scopeConflicts } : {}) };
  }
  return {
    trainingIds,
    source: trainingIds.length === 0 ? null : courseTitle ? 'keyword' : 'text',
    inactiveMatches: hits.filter((t) => !t.applicable).map((t) => t.name),
    ...(trainingIds.length === 0 && ignoredKeywords.length ? { ignoredKeywords } : {}),
    ...(scopeConflicts.length ? { scopeConflicts } : {}),
  };
}

/** 교육시간을 인정 교육 수로 나눈다 (4시간짜리 4대폭력 통합교육 → 교육마다 1시간) */
export function splitHours(hours: number | null, count: number): number | null {
  if (hours === null || count === 0) return null;
  return Math.round((hours / count) * 100) / 100;
}
