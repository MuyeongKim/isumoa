import type { CertificateListItem } from './types.ts';

const compact = (value: string) => value.normalize('NFC').replace(/\s+/g, '').toLowerCase();

/** 여러 검색어는 필드 전체에서 모두 맞아야 한다. 판독하지 못한 값이 있어도 다른 필드로 찾을 수 있다. */
export function matchesReviewSearch(item: CertificateListItem, query: string, trainingNames: ReadonlyMap<number, string>): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean).map(compact);
  if (!words.length) return true;
  const fields = [item.employee?.name, item.employee?.empNo, item.personName, item.courseTitle, item.fileName,
    ...item.trainingIds.map(id => trainingNames.get(id))]
    .filter((value): value is string => typeof value === 'string').map(compact);
  return words.every(word => fields.some(field => field.includes(word)));
}
