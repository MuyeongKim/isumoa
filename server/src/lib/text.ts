// 한글 문자열 정리 도구.
// Mac에서 만든 파일 이름·텍스트는 자모가 분리된 NFD 형태일 수 있어 항상 NFC로 맞춘다.

/** NFC로 맞추고 앞뒤 공백을 지우고, 가운데 연속 공백은 하나로 줄인다 */
export function cleanText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 빈 문자열이면 null */
export function cleanOrNull(value: unknown): string | null {
  const text = cleanText(value);
  return text === '' ? null : text;
}

/** 이름 비교용 키: NFC + 모든 공백 제거 */
export function nameKey(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, '');
}
