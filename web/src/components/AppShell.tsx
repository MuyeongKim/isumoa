import {
  BookOpenCheck,
  Download,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Power,
  Settings,
  Stamp,
  Table2,
  Upload,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useMatches } from 'react-router';
import { ROLE_LABELS, type Overview } from '@shared/types.ts';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { useCurrentUser, useLogout, useMeta } from '@/lib/session';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { SealMark } from './SealMark';

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /** 메뉴 옆에 보여 줄 숫자 */
  badge?: 'drafts';
}

const NAV: { group: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    group: '업무',
    items: [
      { label: '대시보드', icon: LayoutDashboard, to: '/' },
      { label: '이수증 올리기', icon: Upload, to: '/upload' },
      { label: '검수함', icon: Stamp, to: '/review', badge: 'drafts' },
      { label: '이수 현황', icon: Table2, to: '/status' },
      { label: '내보내기', icon: Download, to: '/export' },
    ],
  },
  {
    group: '기준 정보',
    items: [
      { label: '직원 명단', icon: Users, to: '/employees' },
      { label: '교육 과정', icon: BookOpenCheck, to: '/trainings' },
    ],
  },
  { group: '관리', adminOnly: true, items: [{ label: '설정', icon: Settings, to: '/settings' }] },
];

export function AppShell() {
  const me = useCurrentUser();
  const { data: meta } = useMeta();
  const logout = useLogout();
  const [quitOpen, setQuitOpen] = useState(false);
  const [quitState, setQuitState] = useState<'idle' | 'busy' | 'done'>('idle');

  // PC 설치판: 서버를 끄고, 이 창에는 끈 뒤의 안내를 띄운다
  async function quit() {
    setQuitState('busy');
    try {
      await api.post('/system/shutdown');
    } finally {
      setQuitState('done');
    }
  }
  const [passwordOpen, setPasswordOpen] = useState(false);
  const wide = useMatches().some((m) => (m.handle as { wide?: boolean } | undefined)?.wide);
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/overview'),
    enabled: !me.mustChangePassword,
    refetchInterval: 30_000,
  });

  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="flex flex-col bg-navy text-white/80 md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <SealMark className="size-10" />
          <div className="min-w-0">
            <p className="truncate font-serif text-[15px] leading-tight font-semibold text-white">
              {meta?.orgName || '기관명 미설정'}
            </p>
            <p className="mt-1 text-[12px] leading-tight text-gold">법정교육 이수증 종합 플랫폼</p>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="주 메뉴">
          {NAV.filter((g) => !g.adminOnly || me.role === 'admin').map((group) => (
            <div key={group.group}>
              <p className="px-3 pb-1.5 text-[12px] text-white/45">{group.group}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-[14px] transition-colors',
                          isActive
                            ? 'border-gold bg-white/10 font-medium text-white'
                            : 'border-transparent hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      <item.icon className="size-4 shrink-0" aria-hidden />
                      {item.label}
                      {item.badge === 'drafts' && (overview.data?.drafts ?? 0) > 0 && (
                        <span className="ml-auto rounded-full bg-gold/90 px-1.5 text-[11.5px] leading-[18px] font-semibold text-navy tabular-nums">
                          {overview.data!.drafts}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="text-[14px] font-medium text-white">
            {me.name}
            <span className="ml-1.5 text-[12px] font-normal text-white/55">{ROLE_LABELS[me.role]}</span>
          </p>
          {me.role === 'clerk' && (
            <p className="mt-0.5 truncate text-[12px] text-white/55">
              {me.departments.length > 0 ? me.departments.map((d) => d.name).join(', ') : '담당 부서 없음'}
            </p>
          )}
          <div className="mt-3 flex gap-1">
            <button
              type="button"
              onClick={() => setPasswordOpen(true)}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12.5px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              <KeyRound className="size-3.5" aria-hidden />
              비밀번호 변경
            </button>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12.5px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-3.5" aria-hidden />
              로그아웃
            </button>
          </div>
          {meta?.desktop && me.role === 'admin' && (
            <button
              type="button"
              onClick={() => setQuitOpen(true)}
              className="mt-1 inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12.5px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              <Power className="size-3.5" aria-hidden />
              프로그램 끄기
            </button>
          )}
        </div>
      </aside>

      <main className="min-w-0 px-5 py-7 md:px-10 md:py-9">
        <div className={cn('mx-auto', wide ? 'max-w-[1680px]' : 'max-w-[1180px]')}>
          <Outlet />
        </div>
      </main>

      <ConfirmDialog
        open={quitOpen && quitState !== 'done'}
        title="프로그램 끄기"
        description="처리 중인 이수증이 있으면 마친 뒤 프로그램을 끕니다. 다시 쓰려면 바탕화면의 '법정교육 이수증'을 누르세요."
        confirmLabel="끄기"
        busy={quitState === 'busy'}
        onConfirm={() => void quit()}
        onClose={() => setQuitOpen(false)}
      />
      {quitState === 'done' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6 text-center">
          <div>
            <p className="font-serif text-[22px] font-semibold">프로그램을 껐습니다</p>
            <p className="mt-2 text-ink-soft">이 창을 닫아도 됩니다. 다시 쓰려면 바탕화면의 &lsquo;법정교육 이수증&rsquo;을 누르세요.</p>
          </div>
        </div>
      )}
      <ChangePasswordDialog
        open={me.mustChangePassword || passwordOpen}
        forced={me.mustChangePassword}
        onClose={() => setPasswordOpen(false)}
      />
    </div>
  );
}
