import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

// 머리행은 옅은 바탕에 작은 글씨, 행 사이는 가는 선. 마우스를 올린 행은 옅게 칠한다

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-line bg-sheet shadow-surface', className)}>
      <table className="w-full border-collapse text-left text-[14px]">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-line bg-head px-3 py-2.5 text-[12.5px] font-semibold whitespace-nowrap text-ink-faint',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('border-b border-line px-3 py-2.5 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors last:[&>td]:border-b-0 hover:bg-paper/60', className)} {...rest}>
      {children}
    </tr>
  );
}

/** 표 아래 "총 n명 · 1/3쪽" 과 쪽 넘김 */
export function Pager({
  page,
  pageCount,
  onPage,
  summary,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  summary: ReactNode;
}) {
  return (
    <div className="mt-3 flex items-center justify-between text-[13px] text-ink-soft">
      <span>{summary}</span>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-md px-2.5 py-1 hover:bg-ink/[0.05] disabled:text-ink-faint/60 disabled:hover:bg-transparent"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            이전
          </button>
          <span className="px-2 tabular-nums">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="rounded-md px-2.5 py-1 hover:bg-ink/[0.05] disabled:text-ink-faint/60 disabled:hover:bg-transparent"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
