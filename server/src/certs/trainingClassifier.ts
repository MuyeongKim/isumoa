// 과정명으로 어떤 법정교육인지 정한다.
// 공식 목록은 발급기관·연도를 함께 확인한다. 그 밖에는 확정 매핑 → 교육별 키워드 순서로 본다.
// 통합과정(예: 4대폭력)은 여러 교육에 같은 키워드가 들어 있어 한 장으로 여러 교육이 정해진다.
import type { CertificateFlag } from '../../../shared/types.ts';
import { UNIEDU_CATALOG_YEAR, UNIEDU_PUBLIC_COURSES, UNIEDU_SCHEDULED_COURSES } from '../../../shared/unieduCatalog.ts';

export interface ClassifiableTraining {
  id: number;
  code?: string;
  name: string;
  keywords: string[];
  /** 사용 중이고 그해에 적용되는 교육 */
  applicable: boolean;
}

export interface Classification {
  trainingIds: number[];
  source: 'catalog' | 'learned' | 'keyword' | 'text' | 'name' | null;
  /** 키워드는 맞지만 사용하지 않는 교육 */
  inactiveMatches: string[];
  ignoredKeywords?: string[];
  scopeConflicts?: string[];
}

export interface ClassificationContext {
  provider?: string | null;
  year?: number | null;
  fullText?: string;
  hours?: number | null;
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

// 목록의 구두점·로마 숫자 표현 차이만 정규화한다. Ⅰ/Ⅱ/Ⅲ는 서로 다른 과정으로 유지한다.
const unieduKey = (title: string) => courseTitleKey(title.normalize('NFKC').replace(/[․・∙]/g, ''));
const unieduCourses = new Map(UNIEDU_PUBLIC_COURSES.map(course => [unieduKey(course.title), course]));
const scheduledUnieduCourses = new Set(UNIEDU_SCHEDULED_COURSES.map(unieduKey));
const unieduProviders = new Set(['통일교육원', '국립통일교육원', '국립평화통일민주교육원']);
function isUnieduProvider(provider: string | null | undefined): boolean {
  return unieduProviders.has(squeeze(provider ?? '').replace(/^통일부/, '').replace(/장$/, ''));
}
function isMicrolearning(context: ClassificationContext): boolean {
  return /마이크로러닝|(?:이수증|수료증)미발급/.test(semanticText(context.fullText ?? ''));
}
function verifiedUnieduCourse(title: string, context: ClassificationContext) {
  return isUnieduProvider(context.provider) && context.year === UNIEDU_CATALOG_YEAR && !isMicrolearning(context)
    ? unieduCourses.get(unieduKey(title)) : undefined;
}
function isUnification(training: Pick<ClassifiableTraining, 'name' | 'code'>): boolean {
  return training.code === 'unification' || /^(?:공공부문)?(?:평화)?통일(?:의식)?교육$/.test(courseTitleKey(training.name));
}

/** 공식 목록은 개인 이수의 증명이 아니다. 원본 값이 불명확하면 검수 표시를 남긴다. */
export function unieduCertificateFlags(courseTitle: string | null, context: ClassificationContext): CertificateFlag[] {
  const key = courseTitle ? unieduKey(courseTitle) : '';
  const course = unieduCourses.get(key);
  const scheduled = scheduledUnieduCourses.has(key);
  const warning = (message: string): CertificateFlag[] => [{ code: 'training-catalog-check', level: 'warning', message }];
  if (!(course || scheduled || isUnieduProvider(context.provider))) return [];
  if (isMicrolearning(context)) return warning('마이크로러닝·이수증 미발급 표시가 있어 공식 통일교육 연결을 적용하지 않았습니다. 정규과정 수료증인지 원본을 확인해 주세요.');
  if (!(course || scheduled)) return warning('국립통일교육원 발급기관은 확인했지만 공식 공공과정 목록과 과정명이 일치하지 않습니다. 글자 판독과 과정의 인정 범위를 원본에서 확인해 주세요.');
  if (!isUnieduProvider(context.provider)) return warning('국립통일교육원 공식 과정명과 일치하지만 발급기관을 확인하지 못했습니다. 원본의 교육기관과 인정 범위를 확인해 주세요.');
  if (scheduled) return warning('개설 예정으로만 확인한 통일교육 과정입니다. 정규과정 개설·이수 여부를 확인해 주세요.');
  if (context.year !== UNIEDU_CATALOG_YEAR) return warning('확인한 공식 통일교육 목록은 2026년 기준입니다. 이 수료증의 대상 연도와 인정 범위를 확인해 주세요.');
  if (course && context.hours != null && context.hours !== course.recognizedHours) return warning(`수료증의 교육시간(${context.hours}시간)이 공식 과정표(${course.recognizedHours}시간)와 다릅니다. 수료증 시간을 유지했으니 원본과 대조해 주세요.`);
  return [];
}

/** 공식 과정목록과 실제 수료증에서 확인한 서로 다른 주제. 통합과정은 제목에 양쪽 주제가 있으면 허용한다.
 * 근거: docs/research/{nhi-course-rules-2026-10-27,uniedu-course-rules-2026-10-29}.json
 */
export function trainingScopeConflict(courseTitle: string | null, training: { name: string; code?: string }, context: ClassificationContext = {}): string | null {
  if (!courseTitle) return null;
  const title = semanticText(courseTitle);
  const target = semanticText(training.name);
  if (verifiedUnieduCourse(courseTitle, context) && (training.code === 'national-security' || /^(?:공직자)?안보교육$/.test(target))) {
    return `국립통일교육원 공식 통일교육 과정이 '${training.name}'에 연결되어 있습니다. 통일교육으로 연결하고, 안보교육 중복 인정은 별도 근거를 확인해 주세요.`;
  }
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
  context: ClassificationContext = {},
): Classification {
  context = { ...context, fullText };
  const catalogKey = courseTitle ? unieduKey(courseTitle) : '';
  const catalogTitle = unieduCourses.has(catalogKey) || scheduledUnieduCourses.has(catalogKey);
  const officialCourse = courseTitle ? verifiedUnieduCourse(courseTitle, context) : undefined;
  // 깨진 제목·예정 과정도 일반 키워드로 돌아가 자동 연결하지 않는다.
  if (isUnieduProvider(context.provider) && !officialCourse) return { trainingIds: [], source: null, inactiveMatches: [] };
  const scopeConflicts: string[] = [];
  const compatible = (id: number) => {
    const training = trainings.find(t => t.id === id);
    // 확정할 때 저장한 과정명 연결도 다른 발급기관으로 확대하지 않는다.
    if (training && catalogTitle && isUnification(training) && !officialCourse) return false;
    const conflict = training && trainingScopeConflict(courseTitle, training, context);
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
    if (officialCourse) {
      const candidates = trainings.filter(t => t.applicable && isUnification(t));
      return { trainingIds: candidates.length === 1 ? [candidates[0].id] : [], source: 'catalog',
        inactiveMatches: trainings.filter(t => !t.applicable && isUnification(t)).map(t => t.name),
        ...(scopeConflicts.length ? { scopeConflicts } : {}) };
    }
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
