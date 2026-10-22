import type { ReqType } from '@shared/types.ts';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

/** 이수 기준을 사람이 읽는 문장으로: "연 2시간 이상", "연 1회 이상" */
export function requirementText(reqType: ReqType, reqValue: number): string {
  return reqType === 'hours' ? `연 ${reqValue}시간 이상` : `연 ${reqValue}회 이상`;
}

/** 서버의 UTC 시각을 한국 시간 "2026. 10. 22. 14:05"로 */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(new Date(iso));
}

export function formatNumber(n: number): string {
  return n.toLocaleString('ko-KR');
}
