// 감사 로그 작업 이름. 서버가 남기는 action 값과 화면에 보여 줄 이름·분류.
// 새 작업을 남기게 되면 여기에도 더한다 (없으면 화면에 action 값이 그대로 보인다).

export const AUDIT_CATEGORIES = {
  login: '로그인',
  account: '계정·부서',
  roster: '직원 명단',
  certificate: '이수증',
  export: '내보내기',
  settings: '설정·교육 과정',
  security: '보안·백업·파기',
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;

export const AUDIT_ACTIONS: Record<string, { label: string; category: AuditCategory }> = {
  setup: { label: '처음 설정', category: 'login' },
  login: { label: '로그인', category: 'login' },
  logout: { label: '로그아웃', category: 'login' },
  'login.failed': { label: '로그인 실패', category: 'login' },
  'login.locked': { label: '로그인 잠김', category: 'login' },
  'password.change': { label: '비밀번호 변경', category: 'login' },
  'user.create': { label: '계정 만들기', category: 'account' },
  'user.update': { label: '계정 바꾸기', category: 'account' },
  'user.reset-password': { label: '비밀번호 초기화', category: 'account' },
  'department.create': { label: '부서 추가', category: 'account' },
  'department.update': { label: '부서 바꾸기', category: 'account' },
  'department.delete': { label: '부서 삭제', category: 'account' },
  'employee.create': { label: '직원 추가', category: 'roster' },
  'employee.update': { label: '직원 정보 바꾸기', category: 'roster' },
  'employee.import': { label: '명단 일괄 반영', category: 'roster' },
  'batch.create': { label: '이수증 묶음 만들기', category: 'certificate' },
  'batch.reprocess': { label: '이수증 다시 읽기', category: 'certificate' },
  'file.download': { label: '원본 파일 받기', category: 'certificate' },
  'certificate.confirm': { label: '이수증 확정', category: 'certificate' },
  'certificate.bulk-confirm': { label: '이수증 일괄 확정', category: 'certificate' },
  'certificate.exclude': { label: '이수증 제외', category: 'certificate' },
  'certificate.reopen': { label: '검수 대기로 되돌리기', category: 'certificate' },
  'export.excel': { label: '현황 엑셀 받기', category: 'export' },
  'export.zip': { label: '이수증 ZIP 받기', category: 'export' },
  'export.pdf': { label: '합본 PDF 받기', category: 'export' },
  'settings.org': { label: '기관 정보 바꾸기', category: 'settings' },
  'settings.ai': { label: 'AI 연결 바꾸기', category: 'settings' },
  'settings.ai.test': { label: 'AI 연결 테스트', category: 'settings' },
  'training.create': { label: '교육 과정 추가', category: 'settings' },
  'training.update': { label: '교육 과정 바꾸기', category: 'settings' },
  'settings.retention': { label: '보관기간 바꾸기', category: 'security' },
  'retention.purge': { label: '보관기간 지난 자료 파기', category: 'security' },
  'logs.prune': { label: '보관기간 지난 기록 정리', category: 'security' },
  'logs.verify': { label: '기록 위·변조 확인', category: 'security' },
  'accesslog.review': { label: '접속기록 월 점검', category: 'security' },
  'backup.run': { label: '백업', category: 'security' },
};

export function actionsOf(category: AuditCategory): string[] {
  return Object.entries(AUDIT_ACTIONS)
    .filter(([, a]) => a.category === category)
    .map(([action]) => action);
}
