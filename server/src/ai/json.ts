// AI 답에서 JSON 꺼내기. 서버·모델마다 답 모양이 달라서 넉넉하게 받아 준다.
//  - <think>…</think> 같은 생각 과정은 버린다
//  - ```json … ``` 코드 울타리는 벗긴다
//  - 앞뒤 설명 문장이 있어도 처음 나오는 완전한 JSON 객체 하나를 찾는다

export function stripThinking(text: string): string {
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/^[\s\S]*?<\/think(?:ing)?>/i, '') // 여는 태그 없이 닫는 태그만 있는 경우
    .trim();
}

/** 문자열 안의 따옴표·괄호를 고려해 처음 나오는 균형 잡힌 {...}를 찾는다 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null; // 잘린 답
}

export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text).replace(/```(?:json)?/gi, '');
  const candidate = firstJsonObject(cleaned);
  if (!candidate) throw new Error('답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(candidate);
}
