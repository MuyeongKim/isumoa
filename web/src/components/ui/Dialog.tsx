import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router';
import type { EditGuard } from '@/lib/unsavedChanges';
import { Button } from './Button';
import { cn } from '@/lib/format';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** false면 바깥 클릭·Esc·닫기 버튼으로 닫을 수 없다 (예: 비밀번호 변경 강제) */
  dismissible?: boolean;
  dirty?: boolean;
  busy?: boolean;
  onSave?: () => Promise<boolean>;
  width?: 'md' | 'lg';
  children: ReactNode;
}

/** 브라우저 기본 <dialog>를 쓰는 대화상자. 열릴 때마다 내용을 새로 그려서 입력값이 초기화된다 */
export function Dialog({ open, onClose, title, description, dismissible = true, dirty = false, busy = false, onSave, width = 'md', children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const guard = useOutletContext<EditGuard | undefined>();
  const guarded = open && onSave !== undefined;
  useLayoutEffect(() => {
    if (!guarded) return;
    guard?.setPendingEdits({ dirty, busy, save: onSave!, discard: onClose, saveDescription: '편집한 정보를 저장한 뒤 이동합니다.' });
  }, [guarded, guard, dirty, busy, onSave, onClose]);
  useEffect(() => {
    if (!guarded) return;
    return () => guard?.clearPendingEdits();
  }, [guarded, guard]);
  function requestClose() {
    if (busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }


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

  return (<>
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) requestClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) requestClose();
      }}
      className={cn(
        'm-auto max-h-[calc(100vh-48px)] rounded-2xl border border-line/70 bg-sheet p-0 text-ink shadow-float',
        width === 'md' ? 'w-[min(520px,calc(100vw-32px))]' : 'w-[min(760px,calc(100vw-32px))]',
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100vh-48px)] flex-col">
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
            <div>
              <h2 className="text-[18px] font-bold">{title}</h2>
              {description && <div className="mt-1 text-[13.5px] text-ink-soft">{description}</div>}
            </div>
            {dismissible && !busy && (
              <button
                type="button"
                onClick={requestClose}
                className="-mt-0.5 -mr-2 rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-ink/[0.06] hover:text-ink"
                aria-label="닫기"
              >
                <X className="size-5" />
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-6 pt-2 pb-6">{children}</div>
        </div>
      )}
    </dialog>
    {dirty && <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)} title="변경사항을 버릴까요?">
      <p className="text-[14px] text-ink-soft">저장하지 않은 수정값이 있습니다. 계속 편집하거나 변경사항을 버리고 닫을 수 있습니다.</p>
      <DialogActions>
        <Button onClick={() => setDiscardOpen(false)} data-autofocus>계속 편집</Button>
        <Button variant="danger" onClick={() => { setDiscardOpen(false); onClose(); }}>버리고 닫기</Button>
      </DialogActions>
    </Dialog>}
  </>);
}

/** 대화상자 아래쪽 버튼 줄 */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}
