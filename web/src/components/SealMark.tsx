import { cn } from '@/lib/format';

/** 결재란·완료 표시에 찍는 동그란 '확인' 도장 */
export function ConfirmStamp({ className, animate = false }: { className?: string; animate?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex size-11 -rotate-8 items-center justify-center rounded-full border-2 border-seal font-serif text-[13px] font-semibold text-seal',
        animate && 'animate-stamp',
        className,
      )}
      aria-label="확인"
    >
      확인
    </span>
  );
}
