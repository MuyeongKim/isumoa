import { cn } from '@/lib/format';
import { ConfirmStamp } from './SealMark';

/**
 * 공문서 결재란 모양의 진행 표시. 끝난 단계에는 '확인' 도장이 찍힌다.
 * current: 진행 중인 단계 번호 (steps.length면 모두 끝남)
 */
export function ApprovalSteps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="inline-flex border border-ink/60 bg-sheet text-[12.5px]" aria-label="진행 단계">
      <li
        aria-hidden
        className="flex w-8 items-center justify-center border-r border-ink/60 tracking-[0.4em] text-ink-soft [writing-mode:vertical-rl]"
      >
        단계
      </li>
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            aria-current={active ? 'step' : undefined}
            className="w-[84px] border-r border-ink/60 last:border-r-0 sm:w-24"
          >
            <div className={cn('border-b border-ink/60 px-2 py-1 text-center', active && 'font-semibold text-navy')}>
              {step}
            </div>
            <div className="flex h-14 items-center justify-center">
              {done && <ConfirmStamp animate={index === current - 1} className="size-10 text-[11.5px]" />}
              {active && <span className="text-[12px] text-navy">진행 중</span>}
              {done && <span className="sr-only">완료</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
