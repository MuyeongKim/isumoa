import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { useMe, useMeta } from '@/lib/session';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const meta = useMeta();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 다른 사이트로 보내는 주소는 받지 않는다
  const next = params.get('next');
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  if (meta.data?.needsSetup) return <Navigate to="/setup" replace />;
  if (me.data) return <Navigate to={target} replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { loginId: form.get('loginId'), password: form.get('password') });
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(target, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout orgName={meta.data?.orgName ?? ''}>
      <h1 className="text-[26px] font-bold tracking-[-0.03em]">로그인</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <FormError message={error} />
        <Field label="아이디" htmlFor="loginId">
          <Input id="loginId" name="loginId" autoComplete="username" required autoFocus />
        </Field>
        <Field label="비밀번호" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          로그인
        </Button>
      </form>
      <p className="mt-6 text-[12.5px] text-ink-faint">
        계정이 없거나 잠겼으면 교육 담당 관리자에게 문의하세요. 비밀번호를 5번 틀리면 10분 동안 잠깁니다.
      </p>
    </AuthLayout>
  );
}
