export const DEFAULT_PERSONAL_TITLE = '{연도}년_{부서}_{성명}_이수증모음';
export const PERSONAL_TITLE_FIELDS = ['연도', '부서', '성명', '사번'] as const;

/** 개인별 다운로드 API와 같은 제목 범위. 파일명에 못 쓰는 문자는 서버가 치환하므로 여기서는 거절하지 않는다. */
export function personalTitleError(value: string): string | null {
  const title = value.trim();
  if (!title) return '개인별 PDF 제목을 입력해 주세요.';
  if (title.length > 150) return '개인별 PDF 제목은 150자 이내로 입력해 주세요.';
  if ([...title.matchAll(/\{([^{}]+)\}/g)].some(match => !PERSONAL_TITLE_FIELDS.some(key => key === match[1]))) {
    return '제목에는 {연도}, {부서}, {성명}, {사번}만 사용할 수 있습니다.';
  }
  return null;
}

/** ZIP 제목은 토큰을 치환하지 않는 고정 제목이다. 빈 입력은 API에 보내지 않고 기본 제목을 사용한다. */
export function personalArchiveTitleError(value: string): string | null {
  return value.trim().length > 100 ? 'ZIP 파일 제목은 100자 이내로 입력해 주세요.' : null;
}

export function personalTitle(template: string, values: Record<(typeof PERSONAL_TITLE_FIELDS)[number], string>): string {
  return template.replace(/\{(연도|부서|성명|사번)\}/g, (_, key: keyof typeof values) => values[key]);
}
