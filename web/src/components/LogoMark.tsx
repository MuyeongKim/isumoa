import { MARK } from '@/brand/glyphs';
import { cn } from '@/lib/format';

/**
 * 이수모아 로고(빨간 직인 + "이수 / 모아"). 좌표는 npm run brand가 만든 web/src/brand/glyphs.ts.
 * 큰 곳(로그인 등)에는 모서리 괄호가 있는 full, 작은 곳(메뉴 위쪽 등)에는 글자를 키운 compact.
 */
export function LogoMark({ variant = 'compact', className }: { variant?: 'full' | 'compact'; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={cn('shrink-0', className)} role="img" aria-label="이수모아 로고">
      <rect width="100" height="100" rx={MARK[variant].radius} fill="var(--color-seal)" />
      {variant === 'full' && (
        <path d={MARK.full.bracketsPath} fill="none" stroke="#fff" strokeWidth={MARK.full.bracketsWidth} strokeLinecap="round" strokeLinejoin="round" />
      )}
      <path d={MARK[variant].glyphs.join('')} fill="#fff" />
    </svg>
  );
}
