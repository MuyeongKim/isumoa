import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useMe, useMeta } from '@/lib/session';

function FullPageMessage({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center text-[13px] text-ink-faint">{children}</div>;
}

/** 초기 설정 → 로그인 순서로 확인하고, 통과하면 화면을 보여 준다 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const meta = useMeta();
  const me = useMe();
  const location = useLocation();

  if (meta.isError || me.isError) {
    return <FullPageMessage>서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인한 뒤 새로고침해 주세요.</FullPageMessage>;
  }
  if (meta.isPending || me.isPending) return <FullPageMessage>불러오는 중…</FullPageMessage>;
  if (meta.data.needsSetup) return <Navigate to="/setup" replace />;
  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}

export function AdminOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.data?.role !== 'admin') {
    return <p className="py-16 text-center text-ink-soft">관리자만 볼 수 있는 화면입니다.</p>;
  }
  return children;
}
