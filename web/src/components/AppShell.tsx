import { BookOpen, KeyRound, LogOut, Power, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useBlocker, useMatches } from 'react-router';
import { toast } from 'sonner';
import { ROLE_LABELS, type Overview } from '@shared/types.ts';
import { api, errorMessage } from '@/lib/api';
import { withBase } from '@/lib/base';
import { cn } from '@/lib/format';
import { useCurrentUser, useLogout, useMeta } from '@/lib/session';
import { ChangePasswordDialog } from './ChangePasswordDialog';
import { CommandPalette, Kbd } from './CommandPalette';
import { ConfirmDialog } from './ConfirmDialog';
import { NAV } from './nav';
import { LogoMark } from './LogoMark';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';
import { FormError } from './ui/Field';
import type { EditGuard, PendingEdits } from '@/lib/unsavedChanges';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function AppShell() {
  const me = useCurrentUser();
  const { data: meta } = useMeta();
  const logout = useLogout();
  const [quitOpen, setQuitOpen] = useState(false);
  const [quitState, setQuitState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [quitError, setQuitError] = useState<string | null>(null);
  const editsRef = useRef<PendingEdits | null>(null);
  const pendingNavigationRef = useRef(false);
  const [editNotice, setEditNotice] = useState<{ busy: boolean; dirty: boolean; description?: string }>({ busy: false, dirty: false });
  const [exitAction, setExitAction] = useState<'logout' | 'quit' | null>(null);
  const [savingEdits, setSavingEdits] = useState(false);
  const editGuard = useMemo<EditGuard>(() => ({
    setPendingEdits: edits => {
      editsRef.current = edits;
      const busy = edits?.busy ?? false, dirty = edits?.dirty ?? false, description = edits?.saveDescription;
      setEditNotice(previous => previous.busy === busy && previous.dirty === dirty && previous.description === description ? previous : { busy, dirty, description });
    },
    clearPendingEdits: () => {
      editsRef.current = null;
      setEditNotice(previous => !previous.busy && !previous.dirty && !previous.description ? previous : { busy: false, dirty: false });
    },
    hasPendingNavigation: () => pendingNavigationRef.current,
  }), []);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => {
    const shouldBlock = (editsRef.current?.dirty === true || editsRef.current?.busy === true)
      && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
    if (shouldBlock) pendingNavigationRef.current = true;
    return shouldBlock;
  }, []));
  useLayoutEffect(() => {
    pendingNavigationRef.current = blocker.state === 'blocked' || exitAction !== null;
  }, [blocker.state, exitAction]);

  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (!editsRef.current?.dirty && !editsRef.current?.busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, []);

  function requestExit(action: 'logout' | 'quit') {
    if (editsRef.current?.dirty || editsRef.current?.busy) { pendingNavigationRef.current = true; setExitAction(action); }
    else if (action === 'logout') void logout();
    else setQuitOpen(true);
  }

  const continueExit = useCallback(() => {
    pendingNavigationRef.current = false;
    editGuard.clearPendingEdits();
    if (blocker.state === 'blocked') blocker.proceed();
    const action = exitAction;
    setExitAction(null);
    if (action === 'logout') void logout();
    else if (action === 'quit') setQuitOpen(true);
  }, [editGuard, blocker, exitAction, logout]);

  function cancelExit() {
    pendingNavigationRef.current = false;
    if (blocker.state === 'blocked') blocker.reset();
    setExitAction(null);
  }

  async function saveAndLeave() {
    if (editsRef.current?.busy || savingEdits) return;
    if (!editsRef.current?.dirty) { continueExit(); return; }
    setSavingEdits(true);
    try {
      if (await editsRef.current?.save()) continueExit();
      else cancelExit();
    } catch (error) {
      cancelExit();
      toast.error(errorMessage(error));
    } finally { setSavingEdits(false); }
  }

  // 저장 성공으로 편집기가 닫혔을 때만 대기하던 이동을 이어간다. 실패로 남은 편집기는 유지한다.
  useEffect(() => {
    if (savingEdits || editsRef.current !== null) return;
    if (blocker.state === 'blocked' || exitAction !== null) continueExit();
  }, [savingEdits, editNotice.busy, editNotice.dirty, blocker.state, exitAction, continueExit]);

  // PC 설치판: 서버를 끄고, 이 창에는 끈 뒤의 안내를 띄운다
  async function quit() {
    if (quitState === 'busy') return;
    setQuitState('busy');
    setQuitError(null);
    try {
      await api.post('/system/shutdown');
      setQuitState('done');
    } catch (error) {
      setQuitError(errorMessage(error));
      setQuitState('idle');
    }
  }
  const [passwordOpen, setPasswordOpen] = useState(false);
  // 단일 사용자 모드(시범 서버): 앱 로그인이 없으므로 로그아웃·비밀번호 변경은 보이지 않고, 비밀번호 변경 요구도 없다
  const singleUser = meta?.singleUser === true;
  const mustChangePassword = me.mustChangePassword && !singleUser;
  const wide = useMatches().some((m) => (m.handle as { wide?: boolean } | undefined)?.wide);
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/overview'),
    enabled: !mustChangePassword,
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
      <aside className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-b border-line bg-sheet px-3 py-3 md:sticky md:top-0 md:flex md:h-screen md:flex-col md:gap-0 md:border-r md:border-b-0 md:p-0">
        <div className="flex min-w-0 items-center gap-3 px-2 py-1 md:px-5 md:pt-6 md:pb-5">
          <LogoMark className="size-10" />
          <div className="min-w-0">
            <p className="text-[20px] leading-none font-extrabold tracking-[-0.04em]">이수모아</p>
            <p className="mt-1 truncate text-[12.5px] leading-tight text-ink-faint">{meta?.orgName || '기관명 미설정'}</p>
          </div>
        </div>

        <div className="self-center px-1 md:self-auto md:px-3">
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

        <nav className="col-span-2 grid grid-cols-2 gap-1 py-3 sm:grid-cols-4 md:block md:flex-1 md:space-y-6 md:overflow-y-auto md:px-3 md:py-6" aria-label="주 메뉴">
          {NAV.filter((g) => !g.adminOnly || me.role === 'admin').map((group) => (
            <div key={group.group} className="contents md:block">
              <p className="sr-only text-[12.5px] font-medium text-ink-faint md:not-sr-only md:px-3 md:pb-1.5">{group.group}</p>
              <ul className="contents md:block md:space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) =>
                        cn(
                          'group flex h-10 min-w-0 items-center gap-2 rounded-lg px-2 text-[13.5px] transition-colors md:gap-3 md:px-3 md:text-[14.5px]',
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

        <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 border-t border-line px-2 pt-2 md:block md:px-4 md:py-4">
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
          <div className="flex flex-wrap gap-0.5 md:mt-3">
            <a href={withBase('/manual.html')} target="_blank" rel="noopener" className={footerButton}>
              <BookOpen className="size-3.5" aria-hidden />
              사용설명서
            </a>
            {!singleUser && (
              <>
                <button type="button" onClick={() => setPasswordOpen(true)} className={footerButton}>
                  <KeyRound className="size-3.5" aria-hidden />
                  비밀번호 변경
                </button>
                <button type="button" onClick={() => requestExit('logout')} className={footerButton}>
                  <LogOut className="size-3.5" aria-hidden />
                  로그아웃
                </button>
              </>
            )}
            {meta?.desktop && me.role === 'admin' && (
              <button type="button" onClick={() => requestExit('quit')} className={cn(footerButton, 'hover:bg-seal-soft hover:text-seal')}>
                <Power className="size-3.5" aria-hidden />
                프로그램 끄기
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="view-main min-w-0 px-5 py-8 md:px-12 md:py-11">
        <div className={cn('mx-auto', wide ? 'max-w-[1680px]' : 'max-w-[1160px]')}>
          <Outlet context={editGuard} />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Dialog open={blocker.state === 'blocked' || exitAction !== null} title={editNotice.busy ? '처리 중인 작업이 있습니다' : editNotice.dirty ? '저장하지 않은 수정값이 있습니다' : '이동을 계속할까요?'}
        dismissible={!savingEdits && !editNotice.busy} onClose={() => {
          if (savingEdits || editsRef.current?.busy) return;
          cancelExit();
        }}>
        <p className="text-[14px] text-ink-soft">{editNotice.busy ? '처리 중인 작업이 끝나면 이동할 수 있습니다. 입력한 값은 그대로 유지됩니다.' : editNotice.dirty ? editNotice.description ?? '입력한 값을 임시 저장한 뒤 이동할 수 있습니다. 버리고 이동하면 이번에 수정한 값만 취소됩니다.' : '작업이 끝났습니다. 이동을 계속하거나 이 화면에 머무를 수 있습니다.'}</p>
        <DialogActions>
          <Button disabled={savingEdits || editNotice.busy} onClick={cancelExit} data-autofocus>계속 수정</Button>
          {editNotice.dirty && <Button variant="danger" disabled={savingEdits || editNotice.busy} onClick={() => { if (editsRef.current?.busy) return; editsRef.current?.discard(); continueExit(); }}>버리고 이동</Button>}
          <Button variant="primary" loading={savingEdits} disabled={editNotice.busy} onClick={() => void saveAndLeave()}>{editNotice.dirty ? '저장 후 이동' : '이동 계속'}</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog
        open={quitOpen && quitState !== 'done'}
        title="프로그램 끄기"
        description={<div className="space-y-3"><p>처리 중인 이수증이 있으면 마친 뒤 프로그램을 끕니다. 다시 쓰려면 바탕화면의 '이수모아'를 누르세요.</p><FormError message={quitError ? `종료 요청을 처리하지 못했습니다. ${quitError}` : null} /></div>}
        confirmLabel={quitError ? '다시 종료 요청' : '끄기'}
        busy={quitState === 'busy'}
        onConfirm={() => void quit()}
        onClose={() => { if (quitState === 'busy') return; setQuitOpen(false); setQuitError(null); }}
      />
      {quitState === 'done' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-paper p-6 text-center">
          <div>
            <LogoMark variant="full" className="mx-auto mb-5 size-16" />
            <p className="text-[24px] font-bold tracking-[-0.03em]">프로그램 종료를 요청했습니다</p>
            <p className="mt-2 text-ink-soft">진행 중인 처리를 마치면 종료됩니다. 이 창을 닫아도 됩니다. 다시 쓰려면 바탕화면의 &lsquo;이수모아&rsquo;를 누르세요.</p>
          </div>
        </div>
      )}
      {!singleUser && (
        <ChangePasswordDialog open={mustChangePassword || passwordOpen} forced={mustChangePassword} onClose={() => setPasswordOpen(false)} />
      )}
    </div>
  );
}
