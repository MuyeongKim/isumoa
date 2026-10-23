import type { ExtractedCertificate } from '../ai/schema.ts';
import { findDates, parseHours, type ParsedCertificate } from './parseText.ts';

// AI가 "적힌 그대로" 옮긴 값을 규칙 판독과 같은 모양(날짜 YYYY-MM-DD, 시간 숫자)으로 정리한다.

export type ReadFields = Omit<ParsedCertificate, 'looksLikeCertificate'>;

const PROVIDER_HEAD = /(원|센터|기관|연구소|학교|협회|공단|위원회|재단|아카데미)장$/;

function name(value: string | null): string | null {
  if (!value) return null;
  const squeezed = value.replace(/\s+/g, '').replace(/\(.*\)$/, '');
  return /^[가-힣]{2,5}/.exec(squeezed)?.[0] ?? (squeezed || null);
}

function lastDate(...values: (string | null)[]): string | null {
  for (const value of values) {
    const date = value ? findDates(value).at(-1) : undefined;
    if (date) return date;
  }
  return null;
}

export function normalizeAi(c: ExtractedCertificate): ReadFields {
  const hoursInfo = c.hours ? (parseHours(c.hours) ?? (/^\d+(\.\d+)?$/.test(c.hours) ? { hours: Number(c.hours), text: `${c.hours}시간`, sessions: false } : null)) : null;
  return {
    personName: name(c.personName),
    personBirth: c.birthDate ? (findDates(c.birthDate)[0] ?? null) : null,
    personDept: c.department,
    courseTitle: c.courseTitle,
    provider: c.provider?.replace(PROVIDER_HEAD, '$1') ?? null,
    certNo: c.certificateNo ? (/제\s*(.+?)\s*호/.exec(c.certificateNo)?.[1] ?? c.certificateNo) : null,
    // 이수일 칸에 기간을 통째로 넣는 모델이 있어 마지막 날짜를 쓴다
    completedOn: lastDate(c.completionDate, c.periodEnd),
    hours: hoursInfo?.hours ?? null,
    hoursText: hoursInfo?.text ?? c.hours,
    hoursInSessions: hoursInfo?.sessions ?? false,
  };
}
