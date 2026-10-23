// 이름 찾기: "김민" 같은 일부 글자, "ㄱㅁㅈ" 같은 초성, 사번 앞자리로 찾는다.

const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const ONLY_CHOSEONG = /^[ㄱ-ㅎ]+$/;

/** "김민준" → "ㄱㅁㅈ" (한글이 아닌 글자는 그대로) */
export function choseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code <= 11171 ? CHOSEONG[Math.floor(code / 588)] : ch;
  }
  return out;
}

/** 검색어가 이름(또는 사번)에 맞는지. 빈 검색어는 모두 맞는다 */
export function matchesName(query: string, name: string, empNo?: string | null): boolean {
  const q = query.replace(/\s/g, '');
  if (!q) return true;
  const n = name.replace(/\s/g, '');
  if (n.includes(q)) return true;
  if (ONLY_CHOSEONG.test(q) && choseong(n).includes(q)) return true;
  return Boolean(empNo && empNo.startsWith(q));
}
