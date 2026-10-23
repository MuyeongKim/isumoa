import { BookOpen, KeyRound, LogOut, Power, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useMatches } from 'react-router';
import { ROLE_LABELS, type Overview } from '@shared/types.ts';
import { api } from '@/lib/api';
import { withBase } from '@/lib/base';
import { cn } from '@/lib/format';
import { useCurrentUser, useLogout, useMeta } from '@/lib/session';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { CommandPalette, Kbd } from './CommandPalette';
import { ConfirmDialog } from './ConfirmDialog';
import { NAV } from './nav';
import { LogoMark } from './LogoMark';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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

  // Ctrl+K(맥은 ⌘K): 빠른 이동. 한글 입력 상태에서도 되도록 글자 대신 키 위치(KeyK)로 본다
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const footerButton = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-ink-soft transition-colors hover:bg-ink/[0.05] hover:text-ink';

  return (
    <div className="min-h-screen md:grid md:grid-cols-[252px_minmax(0,1fr)]">
      <aside className="flex flex-col border-r border-line bg-sheet md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-3 px-5 pt-6 pb-5">
          <LogoMark className="size-10" />
          <div className="min-w-0">
            <p className="text-[20px] leading-none font-extrabold tracking-[-0.04em]">이수모아</p>
            <p className="mt-1 truncate text-[12.5px] leading-tight text-ink-faint">{meta?.orgName || '기관명 미설정'}</p>
          </div>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-paper/70 px-3 text-[14px] text-ink-faint transition-colors hover:border-line-strong hover:text-ink-soft"
          >
            <Search className="size-4" aria-hidden />
            빠른 이동
            <span className="ml-auto flex gap-0.5">
              <Kbd>{IS_MAC ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-6" aria-label="주 메뉴">
          {NAV.filter((g) => !g.adminOnly || me.role === 'admin').map((group) => (
            <div key={group.group}>
              <p className="px-3 pb-1.5 text-[12.5px] font-medium text-ink-faint">{group.group}</p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      viewTransition
                      className={({ isActive }) =>
                        cn(
                          'group flex h-10 items-center gap-3 rounded-lg px-3 text-[14.5px] transition-colors',
                          isActive ? 'bg-navy-soft font-semibold text-navy' : 'text-ink-soft hover:bg-ink/[0.04] hover:text-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-navy' : 'text-ink-faint group-hover:text-ink-soft')} aria-hidden />
                          {item.label}
                          {item.badge === 'drafts' && (overview.data?.drafts ?? 0) > 0 && (
                            <span
                              className="ml-auto min-w-6 rounded-full bg-navy px-1.5 text-center text-[12px] leading-5 font-bold text-white tabular-nums"
                              aria-label={`검수 대기 ${overview.data!.drafts}건`}
                            >
                              {overview.data!.drafts}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center gap-3 px-1">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-soft text-[14px] font-bold text-navy" aria-hidden>
              {me.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14.5px] leading-tight font-semibold">{me.name}</p>
              <p className="mt-0.5 truncate text-[12.5px] leading-tight text-ink-faint">
                {ROLE_LABELS[me.role]}
                {me.role === 'clerk' && ` · ${me.departments.length > 0 ? me.departments.map((d) => d.name).join(', ') : '담당 부서 없음'}`}
              </p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-0.5">
            <a href={withBase('/manual.html')} target="_blank" rel="noopener" className={footerButton}>
              <BookOpen className="size-3.5" aria-hidden />
              사용설명서
            </a>
            <button type="button" onClick={() => setPasswordOpen(true)} className={footerButton}>
              <KeyRound className="size-3.5" aria-hidden />
              비밀번호 변경
            </button>
            <button type="button" onClick={logout} className={footerButton}>
              <LogOut className="size-3.5" aria-hidden />
              로그아웃
            </button>
            {meta?.desktop && me.role === 'admin' && (
              <button type="button" onClick={() => setQuitOpen(true)} className={cn(footerButton, 'hover:bg-seal-soft hover:text-seal')}>
                <Power className="size-3.5" aria-hidden />
                프로그램 끄기
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="view-main min-w-0 px-5 py-8 md:px-12 md:py-11">
        <div className={cn('mx-auto', wide ? 'max-w-[1680px]' : 'max-w-[1160px]')}>
          <Outlet />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ConfirmDialog
        open={quitOpen && quitState !== 'done'}
        title="프로그램 끄기"
        description="처리 중인 이수증이 있으면 마친 뒤 프로그램을 끕니다. 다시 쓰려면 바탕화면의 '이수모아'를 누르세요."
        confirmLabel="끄기"
        busy={quitState === 'busy'}
        onConfirm={() => void quit()}
        onClose={() => setQuitOpen(false)}
      />
      {quitState === 'done' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6 text-center">
          <div>
            <LogoMark variant="full" className="mx-auto mb-5 size-16" />
            <p className="text-[24px] font-bold tracking-[-0.03em]">프로그램을 껐습니다</p>
            <p className="mt-2 text-ink-soft">이 창을 닫아도 됩니다. 다시 쓰려면 바탕화면의 &lsquo;이수모아&rsquo;를 누르세요.</p>
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
