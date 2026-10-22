import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { Button } from './ui/Button';
import { Dialog, DialogActions } from './ui/Dialog';
import { Field, FormError, Input } from './ui/Field';

export const PASSWORD_RULE = '영문 대·소문자, 숫자, 특수문자 중 2종류 이상이면 10자 이상, 3종류 이상이면 8자 이상';

export function ChangePasswordDialog({
  open,
  forced,
  onClose,
}: {
  open: boolean;
  /** 처음 로그인했거나 초기화된 경우: 바꾸기 전에는 닫을 수 없다 */
  forced: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get('newPassword'));
    if (newPassword !== String(form.get('confirm'))) {
      setError('새 비밀번호와 확인이 서로 다릅니다.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/auth/password', { currentPassword: String(form.get('currentPassword')), newPassword });
      toast.success('비밀번호를 바꿨습니다.');
      await queryClient.invalidateQueries();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!forced}
      title="비밀번호 변경"
      description={forced ? '처음 받은 비밀번호를 본인만 아는 비밀번호로 바꿔야 계속 쓸 수 있습니다.' : undefined}
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="현재 비밀번호" htmlFor="pw-current" required>
          <Input id="pw-current" name="currentPassword" type="password" autoComplete="current-password" required autoFocus />
        </Field>
        <Field label="새 비밀번호" htmlFor="pw-new" required hint={PASSWORD_RULE}>
          <Input id="pw-new" name="newPassword" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="새 비밀번호 확인" htmlFor="pw-confirm" required>
          <Input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <DialogActions>
          {!forced && <Button onClick={onClose}>취소</Button>}
          <Button type="submit" variant="primary" loading={saving}>
            비밀번호 바꾸기
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
