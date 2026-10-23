import { BookOpenCheck, Download, LayoutDashboard, Settings, Stamp, Table2, Upload, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /** 메뉴 옆에 보여 줄 숫자 */
  badge?: 'drafts';
  /** 빠른 이동에서 이 말로도 찾는다 */
  keywords?: string;
}

export const NAV: { group: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    group: '업무',
    items: [
      { label: '대시보드', icon: LayoutDashboard, to: '/', keywords: '홈 처음 이수율' },
      { label: '이수증 올리기', icon: Upload, to: '/upload', keywords: '업로드 pdf 스캔' },
      { label: '검수함', icon: Stamp, to: '/review', badge: 'drafts', keywords: '확정 검수 대기' },
      { label: '이수 현황', icon: Table2, to: '/status', keywords: '미이수 직원별' },
      { label: '내보내기', icon: Download, to: '/export', keywords: '엑셀 zip 합본 다운로드' },
    ],
  },
  {
    group: '기준 정보',
    items: [
      { label: '직원 명단', icon: Users, to: '/employees', keywords: '인사 명단 등록' },
      { label: '교육 과정', icon: BookOpenCheck, to: '/trainings', keywords: '법정교육 기준' },
    ],
  },
  { group: '관리', adminOnly: true, items: [{ label: '설정', icon: Settings, to: '/settings', keywords: '계정 부서 백업 감사 로그' }] },
];
