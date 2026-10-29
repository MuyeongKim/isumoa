const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;
/** Windows와 브라우저 미리보기에서 같은 파일명을 쓴다. */
export function safeFileName(part: string, fallback = '이름없음'): string {
  let name = part.normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  let bounded = '';
  for (const char of [...name].slice(0, 80)) {
    if (new TextEncoder().encode(bounded + char).length > 240) break;
    bounded += char;
  }
  name = bounded.replace(/[. ]+$/, '') || fallback;
  return RESERVED.test(name) ? `_${name}` : name;
}
