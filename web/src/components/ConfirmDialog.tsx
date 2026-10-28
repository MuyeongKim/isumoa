import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

/** 되돌리기 어려운 일을 하기 전에 한 번 더 묻는 대화상자 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} dismissible={!busy}>
      <div className="text-[14px] text-ink-soft">{description}</div>
      <DialogActions>
        <Button disabled={busy} onClick={onClose} data-autofocus={confirmVariant === 'danger' || undefined}>취소</Button>
        <Button variant={confirmVariant} loading={busy} onClick={onConfirm} data-autofocus={confirmVariant === 'primary' || undefined}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
