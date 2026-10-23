import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white shadow-[0_1px_2px_rgb(36_56_166/0.25)] hover:bg-navy-hover disabled:bg-navy/45 disabled:shadow-none',
  secondary: 'border border-line-strong bg-sheet text-ink hover:border-ink-faint/60 hover:bg-paper disabled:text-ink-faint',
  ghost: 'text-ink-soft hover:bg-ink/[0.05] hover:text-ink disabled:text-ink-faint',
  danger: 'border border-seal/35 bg-sheet text-seal hover:bg-seal-soft disabled:opacity-50',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 rounded-md px-3 text-[13.5px]',
  md: 'h-10 rounded-lg px-4 text-[14.5px]',
};

/** 링크(<Link>)를 버튼처럼 보이게 할 때도 같은 모양을 쓴다 */
export function buttonClass(variant: Variant = 'secondary', size: Size = 'md', className?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100',
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button type={type} disabled={disabled || loading} className={buttonClass(variant, size, className)} {...rest}>
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}
