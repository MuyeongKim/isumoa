import type { AiProvider } from './types.ts';

// AI 서버 주소가 기관 안(내부망·이 PC)인지 밖(인터넷)인지. 화면(경고 표시)과 서버(차단)가 함께 쓴다.

/**
 * 기관 안(내부망·이 PC)의 주소인지. 사설 IP, localhost, 점 없는 이름(예: http://ai-server),
 * .local/.internal/.lan 같은 이름을 내부로 본다. Claude API는 항상 외부다.
 */
export function isInternalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  if (/\.(local|internal|lan|intranet|corp|home\.arpa)$/.test(host)) return true;
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^f[cd][0-9a-f]{2}:/.test(host); // IPv6 사설 주소(fc00::/7)
}

/** Claude API는 항상 기관 밖이다 */
export function isExternalAi(provider: AiProvider, baseUrl: string): boolean {
  return provider === 'anthropic' || !isInternalUrl(baseUrl);
}

function origin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.trim();
  }
}

/** 같은 AI 서버인지 (저장된 API 키를 다른 서버로 보내지 않기 위해) */
export function sameAiTarget(a: { provider: AiProvider; baseUrl: string }, b: { provider: AiProvider; baseUrl: string }): boolean {
  return a.provider === b.provider && origin(a.baseUrl) === origin(b.baseUrl);
}
