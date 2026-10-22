import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';

/** 되돌리기 어려운 일을 하기 전에 한 번 더 묻는 대화상자 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="text-[14px] text-ink-soft">{description}</div>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button variant="primary" loading={busy} onClick={onConfirm} data-autofocus>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
