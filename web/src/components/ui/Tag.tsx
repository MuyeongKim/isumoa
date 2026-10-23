import type { ReactNode } from 'react';
import { cn } from '@/lib/format';

export type Tone = 'neutral' | 'navy' | 'ok' | 'warn' | 'seal';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink/[0.06] text-ink-soft',
  navy: 'bg-navy-soft text-navy',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  seal: 'bg-seal-soft text-seal',
};

export function Tag({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-px text-[12.5px] leading-5 font-semibold whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
