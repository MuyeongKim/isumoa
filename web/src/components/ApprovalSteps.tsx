import { Check } from 'lucide-react';
import { cn } from '@/lib/format';

/**
 * 단계 진행 표시: 번호 동그라미를 선으로 잇고, 끝난 단계에는 체크 표시.
 * current: 진행 중인 단계 번호 (steps.length면 모두 끝남)
 */
export function ApprovalSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2" aria-label="진행 단계">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} aria-current={active ? 'step' : undefined} className="flex items-center">
            {index > 0 && <span className={cn('mx-3 h-px w-8 sm:w-12', index <= current ? 'bg-navy' : 'bg-line-strong')} aria-hidden />}
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums transition-colors',
                done && 'bg-navy text-white',
                active && 'bg-sheet text-navy ring-2 ring-navy',
                !done && !active && 'bg-ink/[0.06] text-ink-faint',
              )}
            >
              {done ? <Check className={cn('size-4', index === current - 1 && 'animate-pop-in')} strokeWidth={3} aria-hidden /> : index + 1}
            </span>
            <span className={cn('ml-2 text-[14px] whitespace-nowrap', active ? 'font-bold text-ink' : done ? 'font-medium text-ink-soft' : 'text-ink-faint')}>
              {step}
              {done && <span className="sr-only"> (완료)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
