import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="max-w-[68ch]">
        <h1 className="text-[28px] leading-[1.2] font-bold tracking-[-0.03em]">{title}</h1>
        {description && <p className="mt-2 text-[15px] text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** 내용이 없을 때: 무엇을 하면 되는지 알려 준다 */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-sheet/60 px-6 py-14 text-center">
      <p className="text-[16px] font-semibold">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-[56ch] text-[14px] text-ink-soft">{description}</p>}
      {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** 불러오는 동안 자리를 잡아 두는 회색 줄 (화면이 덜컥 바뀌지 않게) */
export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 py-4" role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-ink/[0.05]" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
