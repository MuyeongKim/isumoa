import { describe, expect, it } from 'vitest';
import type { CertificateListItem } from '../../shared/types.ts';
import { matchesReviewSearch } from '../../shared/reviewSearch.ts';
const row: CertificateListItem = { id: 1, batchId: 1, pageId: 1, pageNo: 1, pageCount: 1, status: 'draft', fileName: 'REPORT (25).pdf', personName: '홍길똥', courseTitle: '제 2 기 공직자 반부패 실무', employee: { id: 1, name: '홍길동', empNo: 'FAKE-001', departmentName: '가상부서', birthDate: null }, trainingIds: [7], completedOn: '2026-04-01', hours: 2, flags: [], route: 'text', reading: false };
const names = new Map([[7, '청탁금지법 등 반부패·청렴교육']]);
describe('검수함 통합 검색', () => {
  it.each(['홍길동', '홍 길 동', '홍길똥', 'fake-001', '청렴교육', '반부패 실무', 'report (25).PDF', '홍길동 청렴 report', ''])('%s를 직원·교육·원본 과정·파일에서 찾는다', query => {
    expect(matchesReviewSearch(row, query, names)).toBe(true);
  });
  it('검색어는 모두 맞아야 하며 다른 이름·교육·파일을 섞어 찾지 않는다', () => {
    expect(matchesReviewSearch(row, '홍길동 정보보안', names)).toBe(false);
    expect(matchesReviewSearch(row, 'report (24)', names)).toBe(false);
  });
  it('직원 미정·교육 미정이어도 판독 이름과 원본 과정·파일로 찾는다', () => {
    const unlinked = { ...row, employee: null, trainingIds: [] };
    expect(matchesReviewSearch(unlinked, '홍길똥 반부패 report', names)).toBe(true);
    expect(matchesReviewSearch(unlinked, '청렴', names)).toBe(false);
  });
  it('한글 NFD 파일명도 NFC 검색어와 맞추고 입력을 변경하지 않는다', () => {
    const local = { ...row, fileName: '가상직원_수료증.jpeg'.normalize('NFD') };
    expect(matchesReviewSearch(local, '가상직원 수료증', names)).toBe(true);
    expect(local.fileName).toBe('가상직원_수료증.jpeg'.normalize('NFD'));
  });
});
