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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="max-w-[72ch]">
        <h1 className="font-serif text-[24px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
        {description && <p className="mt-2 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** 내용이 없을 때: 무엇을 하면 되는지 알려 준다 */
export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line-strong bg-sheet px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="mx-auto mt-1.5 max-w-[56ch] text-[13px] text-ink-soft">{description}</p>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function LoadingRows() {
  return <p className="py-10 text-center text-[13px] text-ink-faint">불러오는 중…</p>;
}
