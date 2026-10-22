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
  source: 'learned' | 'keyword' | 'text' | null;
  /** 키워드는 맞지만 사용하지 않는 교육 */
  inactiveMatches: string[];
}

function squeeze(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

/** 매핑 열쇠: 연도("2026년")·띄어쓰기·문장부호를 빼서 해마다 같은 과정이 같은 열쇠가 되게 한다 */
export function courseTitleKey(title: string): string {
  return title
    .normalize('NFC')
    .replace(/(19|20)\d{2}\s*년?\s*(도)?/g, '')
    .replace(/[\s·ㆍ.,()[\]{}<>「」『』"'‘’“”:;\-_/|~!?]/g, '')
    .toLowerCase();
}

export function classifyTrainings(
  courseTitle: string | null,
  fullText: string,
  trainings: ClassifiableTraining[],
  learned: Map<string, number[]>,
): Classification {
  const applicableIds = new Set(trainings.filter((t) => t.applicable).map((t) => t.id));
  if (courseTitle) {
    const mapped = (learned.get(courseTitleKey(courseTitle)) ?? []).filter((id) => applicableIds.has(id));
    if (mapped.length > 0) return { trainingIds: mapped, source: 'learned', inactiveMatches: [] };
  }

  // 과정명을 못 읽었으면 글 전체에서 찾는다 (정확도가 떨어져 확인 표시가 붙는다)
  const haystack = squeeze(courseTitle ?? fullText);
  const hits = trainings.filter((t) => t.keywords.some((k) => k.trim() !== '' && haystack.includes(squeeze(k))));
  const trainingIds = hits.filter((t) => t.applicable).map((t) => t.id);
  return {
    trainingIds,
    source: trainingIds.length === 0 ? null : courseTitle ? 'keyword' : 'text',
    inactiveMatches: hits.filter((t) => !t.applicable).map((t) => t.name),
  };
}

/** 교육시간을 인정 교육 수로 나눈다 (4시간짜리 4대폭력 통합교육 → 교육마다 1시간) */
export function splitHours(hours: number | null, count: number): number | null {
  if (hours === null || count === 0) return null;
  return Math.round((hours / count) * 100) / 100;
}
