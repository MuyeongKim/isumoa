import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/format';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** false면 바깥 클릭·Esc·닫기 버튼으로 닫을 수 없다 (예: 비밀번호 변경 강제) */
  dismissible?: boolean;
  width?: 'md' | 'lg';
  children: ReactNode;
}

/** 브라우저 기본 <dialog>를 쓰는 대화상자. 열릴 때마다 내용을 새로 그려서 입력값이 초기화된다 */
export function Dialog({ open, onClose, title, description, dismissible = true, width = 'md', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal은 첫 번째 버튼(닫기)에 초점을 준다. 대신 data-autofocus가 붙은 것이나 첫 입력칸에 준다
      dialog
        .querySelector<HTMLElement>('[data-autofocus], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])')
        ?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
      className={cn(
        'm-auto max-h-[calc(100vh-48px)] rounded-lg border border-line bg-sheet p-0 text-ink shadow-[0_18px_48px_-12px_rgb(20_28_46/0.35)]',
        width === 'md' ? 'w-[min(520px,calc(100vw-32px))]' : 'w-[min(760px,calc(100vw-32px))]',
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 className="text-[16px] font-semibold">{title}</h2>
              {description && <div className="mt-1 text-[13px] text-ink-soft">{description}</div>}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="-mr-2 rounded p-1 text-ink-faint hover:bg-paper hover:text-ink"
                aria-label="닫기"
              >
                <X className="size-5" />
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-6 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** 대화상자 아래쪽 버튼 줄 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">{children}</div>;
}
