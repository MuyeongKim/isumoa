import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/format';

const control =
  'rounded-md border border-line-strong bg-sheet px-3 text-[14px] text-ink placeholder:text-ink-faint/70 ' +
  'focus:border-link focus:outline-none focus:ring-2 focus:ring-link/20 disabled:bg-paper disabled:text-ink-faint';

/** 너비를 따로 주지 않았으면 칸을 가득 채운다 */
function width(className?: string): string {
  return /(^|\s)(w-|flex-1)/.test(className ?? '') ? '' : 'w-full';
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-9', width(className), className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-9 pr-8', width(className), className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-20 py-2', width(className), className)} {...rest} />;
}

interface FieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-seal" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-[12.5px] text-seal">{error}</p>
      ) : (
        hint && <p className="text-[12.5px] text-ink-faint">{hint}</p>
      )}
    </div>
  );
}

/** 폼 위쪽에 보여주는 오류 상자 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md border border-seal/30 bg-seal-soft px-3 py-2 text-[13px] text-seal">
      {message}
    </p>
  );
}
