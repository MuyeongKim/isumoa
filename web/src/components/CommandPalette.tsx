import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, Search, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { EMPLOYEE_STATUS_LABELS, type Employee } from '@shared/types.ts';
import { api } from '@/lib/api';
import { cn } from '@/lib/format';
import { choseong, matchesName } from '@/lib/hangul';
import { useCurrentUser } from '@/lib/session';
import { NAV, PALETTE_EXTRA } from './nav';

interface Item {
  id: string;
  group: '메뉴' | '직원';
  label: string;
  hint?: string;
  icon: LucideIcon;
  to: string;
}

const EMPLOYEE_LIMIT = 8;

/** Ctrl+K로 여는 빠른 이동: 메뉴와 직원 이름(초성도)으로 찾아 바로 간다 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get<Employee[]>('/employees'),
    enabled: open,
    staleTime: 60_000,
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery('');
      setActive(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim();
    const pages: Item[] = [...NAV.filter((g) => !g.adminOnly || me.role === 'admin').flatMap((g) => g.items), ...PALETTE_EXTRA]
      .filter((item) => !q || `${item.label} ${item.keywords ?? ''}`.includes(q) || choseong(item.label.replace(/\s/g, '')).includes(q))
      .map((item) => ({ id: `page-${item.to}`, group: '메뉴', label: item.label, icon: item.icon, to: item.to }));
    if (!q) return pages;
    const people: Item[] = (employees.data ?? [])
      .filter((e) => matchesName(q, e.name, e.empNo))
      .sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired') || a.name.localeCompare(b.name, 'ko'))
      .slice(0, EMPLOYEE_LIMIT)
      .map((e) => ({
        id: `employee-${e.id}`,
        group: '직원',
        label: e.name,
        hint: [e.departmentName ?? '부서 없음', e.position, e.status !== 'active' ? EMPLOYEE_STATUS_LABELS[e.status] : null].filter(Boolean).join(' · '),
        icon: UserRound,
        to: `/status?q=${encodeURIComponent(e.name)}${e.departmentId ? `&departmentId=${e.departmentId}` : ''}`,
      }));
    return [...pages, ...people];
  }, [query, employees.data, me.role]);

  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(item: Item | undefined) {
    if (!item) return;
    onClose();
    void navigate(item.to, { viewTransition: true });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[current]);
    }
  }

  return (
    <dialog
      ref={ref}
      aria-label="빠른 이동"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="mx-auto mt-[12vh] mb-auto w-[min(600px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-line/70 bg-sheet p-0 text-ink shadow-float"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 border-b border-line px-5">
            <Search className="size-5 shrink-0 text-ink-faint" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={items[current]?.id}
              placeholder="메뉴나 직원 이름을 입력하세요 (초성도 됩니다: ㄱㅁㅈ)"
              className="h-15 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-faint/70"
            />
          </div>
          <ul ref={listRef} id="palette-list" role="listbox" aria-label="찾은 항목" className="max-h-[min(52vh,440px)] overflow-y-auto p-2">
            {items.length === 0 && (
              <li className="px-3 py-8 text-center text-[14px] text-ink-faint">
                {employees.isLoading ? '직원 명단을 불러오는 중…' : `'${query}'에 맞는 메뉴나 직원이 없습니다`}
              </li>
            )}
            {items.map((item, index) => (
              <li key={item.id} role="presentation">
                {(index === 0 || items[index - 1].group !== item.group) && (
                  <p className="px-3 pt-2 pb-1 text-[12.5px] font-semibold text-ink-faint">{item.group}</p>
                )}
                <button
                  type="button"
                  id={item.id}
                  role="option"
                  aria-selected={index === current}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => go(item)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left',
                    index === current ? 'bg-navy-soft text-navy' : 'text-ink',
                  )}
                >
                  <item.icon className={cn('size-4.5 shrink-0', index === current ? 'text-navy' : 'text-ink-faint')} aria-hidden />
                  <span className="font-semibold">{item.label}</span>
                  {item.hint && <span className="min-w-0 truncate text-[13.5px] text-ink-faint">{item.hint}</span>}
                  {index === current && <CornerDownLeft className="ml-auto size-4 shrink-0" aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
          <p className="flex gap-4 border-t border-line px-5 py-2.5 text-[12.5px] text-ink-faint">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> 고르기
            </span>
            <span>
              <Kbd>Enter</Kbd> 열기
            </span>
            <span>
              <Kbd>Esc</Kbd> 닫기
            </span>
            <span className="ml-auto">직원을 고르면 그 사람의 이수 현황으로 갑니다</span>
          </p>
        </>
      )}
    </dialog>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-sheet px-1 font-sans text-[11.5px] font-semibold text-ink-soft shadow-[0_1px_0_var(--color-line-strong)]">
      {children}
    </kbd>
  );
}
