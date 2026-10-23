import { ROSTER_FIELDS, type RosterFieldKey, type RosterMapping } from './types.ts';

// 인사 명단마다 머리글 이름이 달라서, 흔히 쓰는 이름으로 열을 자동으로 찾는다.
// 서버(파일 처음 읽을 때)와 화면(머리글 줄을 바꿀 때)이 함께 쓴다.
// exact: 머리글이 정확히 이 단어일 때, contains: 머리글에 이 단어가 들어 있을 때
export const HEADER_WORDS: Record<RosterFieldKey, { exact: string[]; contains: string[] }> = {
  empNo: {
    exact: ['사번', '직원번호', '사원번호', '개인번호', '공무원번호', '직번', '인사번호', '관리번호'],
    contains: ['사번', '직원번호', '사원번호'],
  },
  name: { exact: ['성명', '이름', '직원명', '사원명', '한글성명', '성명한글'], contains: ['성명'] },
  department: {
    exact: ['부서', '부서명', '소속', '소속부서', '근무부서', '소속명', '현부서', '부서팀', '과', '팀'],
    contains: ['부서', '소속'],
  },
  position: { exact: ['직급', '직위', '직책', '계급', '직급명', '직위명'], contains: ['직급', '직위'] },
  empType: { exact: ['직종', '직렬', '고용형태', '신분', '직원구분', '근로형태', '구분'], contains: ['직종', '고용형태'] },
  birthDate: { exact: ['생년월일', '생일', '출생일', '주민등록번호', '주민번호'], contains: ['생년월일', '주민'] },
  status: { exact: ['재직상태', '상태', '재직구분', '재직여부'], contains: ['재직'] },
  hiredOn: {
    exact: ['임용일', '입사일', '채용일', '최초임용일', '입사일자', '임용일자', '채용일자'],
    contains: ['임용일', '입사일', '채용일'],
  },
  leftOn: { exact: ['퇴직일', '퇴사일', '퇴직일자', '퇴사일자'], contains: ['퇴직일', '퇴사일'] },
};

export function normalizeHeader(header: string): string {
  return header
    .normalize('NFC')
    .replace(/\s+/g, '')
    .replace(/[()（）[\]·.]/g, '')
    .toLowerCase();
}

function isKnownHeader(cell: string): boolean {
  const h = normalizeHeader(cell);
  return h !== '' && Object.values(HEADER_WORDS).some((w) => w.exact.includes(h));
}

/**
 * 머리글 줄 찾기: 위에 "2026년 직원 명단" 같은 제목 줄이 있는 파일이 많아서
 * 앞쪽 15줄 중 알려진 머리글이 2개 이상 있는 첫 줄을 머리글로 본다.
 */
export function detectHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    if (rows[i].filter(isKnownHeader).length >= 2) return i;
  }
  return 0;
}

export function emptyMapping(): RosterMapping {
  return Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, null])) as RosterMapping;
}

/** 머리글 이름으로 항목별 열 번호를 정한다. 한 열은 한 항목에만 쓴다 */
export function autoMapColumns(headers: string[]): RosterMapping {
  const mapping = emptyMapping();
  const used = new Set<number>();
  const normalized = headers.map(normalizeHeader);

  for (const pass of ['exact', 'contains'] as const) {
    for (const field of ROSTER_FIELDS) {
      if (mapping[field.key] !== null) continue;
      const words = HEADER_WORDS[field.key][pass];
      const index = normalized.findIndex(
        (h, i) => !used.has(i) && h !== '' && words.some((w) => (pass === 'exact' ? h === w : h.includes(w))),
      );
      if (index >= 0) {
        mapping[field.key] = index;
        used.add(index);
      }
    }
  }
  return mapping;
}
