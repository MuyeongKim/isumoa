import { cn } from '@/lib/format';

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-navy' : 'bg-line-strong',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(22_27_38/0.3)] transition-transform duration-200 ease-[var(--ease-out-quint)]',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
