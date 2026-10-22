import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

// 공문서 표처럼: 머리행은 옅은 바탕, 행 사이는 가는 선

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-line bg-sheet', className)}>
      <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  );
}

export function Th({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'border-b border-line bg-navy-soft/70 px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap text-ink-soft',
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
    <td className={cn('border-b border-line px-3 py-2 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}

export function Tr({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('last:[&>td]:border-b-0', className)} {...rest}>
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
            className="rounded px-2 py-1 hover:bg-navy-soft disabled:text-ink-faint/60 disabled:hover:bg-transparent"
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
            className="rounded px-2 py-1 hover:bg-navy-soft disabled:text-ink-faint/60 disabled:hover:bg-transparent"
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
