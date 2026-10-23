import type { CompletionState } from '@shared/types.ts';
import { cn } from '@/lib/format';

// 이수 상태 칸 모양. 색만으로 구분하지 않도록 모양도 다르게: 꽉 참(이수) / 반 참(부분이수) / 테두리만(미이수) / 가는 줄(대상 제외).
// 대시보드 직원 지도와 이수 현황 표가 같은 모양을 쓴다.
export const STATE_CELL: Record<CompletionState, string> = {
  done: 'bg-ok',
  partial: 'bg-[linear-gradient(135deg,var(--color-warn)_50%,var(--color-warn-soft)_50%)] ring-1 ring-warn/50 ring-inset',
  none: 'bg-sheet ring-[1.5px] ring-seal/70 ring-inset',
  exempt: 'bg-[linear-gradient(transparent_42%,var(--color-line-strong)_42%,var(--color-line-strong)_58%,transparent_58%)]',
};

export function StateMark({ state, className }: { state: CompletionState; className?: string }) {
  return <span className={cn('inline-block size-3.5 rounded-[4px] align-middle', STATE_CELL[state], className)} aria-hidden />;
}
