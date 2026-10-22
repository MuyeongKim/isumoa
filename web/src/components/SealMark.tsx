import { cn } from '@/lib/format';

/**
 * 직인 모양 표시. 옛 도장은 오른쪽 줄부터 세로로 읽지만,
 * 처음 보는 사람도 바로 읽도록 가로 줄 순서(법정 / 이수)로 놓았다.
 */
export function SealMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('shrink-0', className)} role="img" aria-label="법정이수 직인">
      <rect x="1" y="1" width="46" height="46" rx="6" fill="var(--color-seal)" />
      <rect x="4.5" y="4.5" width="39" height="39" rx="3" fill="none" stroke="#fff" strokeWidth="1.4" opacity="0.9" />
      <g fill="#fff" fontFamily="var(--font-serif)" fontWeight="600" fontSize="15" textAnchor="middle">
        <text x="15.5" y="21.5">법</text>
        <text x="32.5" y="21.5">정</text>
        <text x="15.5" y="38">이</text>
        <text x="32.5" y="38">수</text>
      </g>
    </svg>
  );
}

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
