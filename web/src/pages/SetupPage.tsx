import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { PASSWORD_RULE } from '@/components/ChangePasswordDialog';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { useMeta } from '@/lib/session';
import { AuthLayout } from './AuthLayout';

/** 처음 실행했을 때 한 번: 기관명과 관리자 계정을 만든다 */
export function SetupPage() {
  const meta = useMeta();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (meta.data && !meta.data.needsSetup) return <Navigate to="/" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password !== String(form.get('confirm'))) {
      setError('비밀번호와 확인이 서로 다릅니다.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/setup', {
        orgName: form.get('orgName'),
        loginId: form.get('loginId'),
        name: form.get('name'),
        password,
      });
      await queryClient.invalidateQueries();
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout orgName="">
      <h1 className="text-[26px] font-bold tracking-[-0.03em]">처음 설정</h1>
      <p className="mt-2 text-[13px] text-ink-soft">
        기관 이름과 관리자 계정을 만듭니다. 관리자 한 계정으로 모든 부서를 관리할 수 있습니다.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <FormError message={error} />
        <Field label="기관명" htmlFor="orgName" required>
          <Input id="orgName" name="orgName" placeholder="예: 가람시청" required autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="관리자 아이디" htmlFor="loginId" required hint="영문·숫자 3~30자">
            <Input id="loginId" name="loginId" autoComplete="username" required />
          </Field>
          <Field label="이름" htmlFor="name" required>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
        </div>
        <Field label="비밀번호" htmlFor="password" required hint={PASSWORD_RULE}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required />
        </Field>
        <Field label="비밀번호 확인" htmlFor="confirm" required>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          설정을 마치고 시작하기
        </Button>
      </form>
    </AuthLayout>
  );
}
