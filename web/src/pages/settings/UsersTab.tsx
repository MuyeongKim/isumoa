import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ROLE_LABELS, type Department, type Role, type UserAccount } from '@shared/types.ts';
import { PASSWORD_RULE } from '@/components/ChangePasswordDialog';
import { LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';

function UserStatus({ user }: { user: UserAccount }) {
  if (!user.active) return <Tag>사용 중지</Tag>;
  if (user.locked) return <Tag tone="seal">잠김</Tag>;
  if (user.mustChangePassword) return <Tag tone="warn">비밀번호 변경 전</Tag>;
  return <Tag tone="ok">사용 중</Tag>;
}

function UserDialog({
  open,
  user,
  departments,
  onClose,
}: {
  open: boolean;
  user: UserAccount | null;
  departments: Department[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const me = useCurrentUser();
  const [role, setRole] = useState<Role>(user?.role ?? 'clerk');
  const [selected, setSelected] = useState<number[]>(user?.departments.map((d) => d.id) ?? []);
  const [active, setActive] = useState(user?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (role === 'clerk' && selected.length === 0) {
      setError('서무 계정은 담당 부서를 하나 이상 골라야 합니다.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, { name: form.get('name'), role, active, departmentIds: selected });
        toast.success(`${form.get('name')} 계정을 저장했습니다.`);
      } else {
        await api.post('/users', {
          loginId: form.get('loginId'),
          name: form.get('name'),
          role,
          password: form.get('password'),
          departmentIds: selected,
        });
        toast.success(`${form.get('name')} 계정을 만들었습니다. 처음 로그인할 때 비밀번호를 바꾸게 됩니다.`);
      }
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['departments'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const isSelf = user?.id === me.id;

  return (
    <Dialog open={open} onClose={onClose} title={user ? '계정 수정' : '계정 만들기'} width="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="아이디" htmlFor="u-login" required={!user} hint={user ? '아이디는 바꿀 수 없습니다' : '영문·숫자 3~30자'}>
            <Input id="u-login" name="loginId" defaultValue={user?.loginId} disabled={!!user} required={!user} autoFocus={!user} />
          </Field>
          <Field label="이름" htmlFor="u-name" required>
            <Input id="u-name" name="name" defaultValue={user?.name} required />
          </Field>
        </div>
        <fieldset>
          <legend className="text-[13px] font-medium">역할</legend>
          <div className="mt-1.5 flex gap-4">
            {(['clerk', 'admin'] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-[14px]">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  disabled={isSelf}
                  onChange={() => setRole(r)}
                  className="size-4 accent-navy"
                />
                {ROLE_LABELS[r]}
                <span className="text-[12.5px] text-ink-faint">
                  {r === 'clerk' ? '담당 부서만 다룸' : '모든 부서와 설정을 다룸'}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {role === 'clerk' && (
          <fieldset>
            <legend className="text-[13px] font-medium">
              담당 부서<span className="ml-0.5 text-seal">*</span>
            </legend>
            {departments.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-ink-soft">먼저 부서를 만들거나 직원 명단을 올려 주세요.</p>
            ) : (
              <div className="mt-1.5 grid max-h-48 grid-cols-2 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border border-line px-3 py-2 sm:grid-cols-3">
                {departments.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-[14px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-navy"
                      checked={selected.includes(d.id)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, d.id] : selected.filter((id) => id !== d.id))
                      }
                    />
                    {d.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {!user && (
          <Field label="처음 비밀번호" htmlFor="u-password" required hint={`${PASSWORD_RULE}. 처음 로그인할 때 본인이 바꾸게 됩니다.`}>
            <Input id="u-password" name="password" type="text" autoComplete="off" required />
          </Field>
        )}
        {user && !isSelf && (
          <label className="flex items-center gap-2 text-[14px]">
            <input type="checkbox" className="size-4 accent-navy" checked={active} onChange={(e) => setActive(e.target.checked)} />
            계정 사용 (끄면 바로 로그아웃되고 로그인할 수 없습니다)
          </label>
        )}
        <DialogActions>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {user ? '저장' : '계정 만들기'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserAccount | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.post(`/users/${user.id}/reset-password`, { password: new FormData(e.currentTarget).get('password') });
      toast.success(`${user.name}의 비밀번호를 초기화했습니다.`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={user !== null}
      onClose={onClose}
      title="비밀번호 초기화"
      description={user && `${user.name}(${user.loginId}) 계정에 임시 비밀번호를 정합니다. 잠금도 풀립니다.`}
    >
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
        <Field label="임시 비밀번호" htmlFor="reset-pw" required hint={`${PASSWORD_RULE}. 다음 로그인 때 본인이 바꾸게 됩니다.`}>
          <Input id="reset-pw" name="password" type="text" autoComplete="off" required autoFocus />
        </Field>
        <DialogActions>
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" loading={saving}>
            초기화
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function UsersTab() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserAccount[]>('/users') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const [editing, setEditing] = useState<UserAccount | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserAccount | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-ink-soft">서무는 담당 부서의 직원과 이수증만 보고 다룰 수 있습니다.</p>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <UserPlus className="size-4" aria-hidden />
          계정 만들기
        </Button>
      </div>
      {users.isPending ? (
        <LoadingRows />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th className="w-32">아이디</Th>
              <Th className="w-28">이름</Th>
              <Th className="w-20">역할</Th>
              <Th>담당 부서</Th>
              <Th className="w-32">상태</Th>
              <Th className="w-44">마지막 로그인</Th>
              <Th className="w-44">
                <span className="sr-only">관리</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <Tr key={u.id} className={cn(!u.active && 'text-ink-faint')}>
                <Td className="font-medium">{u.loginId}</Td>
                <Td>{u.name}</Td>
                <Td>{ROLE_LABELS[u.role]}</Td>
                <Td className="text-ink-soft">
                  {u.role === 'admin' ? '전체' : u.departments.map((d) => d.name).join(', ') || '없음'}
                </Td>
                <Td>
                  <UserStatus user={u} />
                </Td>
                <Td className="whitespace-nowrap text-ink-soft tabular-nums">{formatDateTime(u.lastLoginAt)}</Td>
                <Td className="text-right whitespace-nowrap">
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                    onClick={() => setEditing(u)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft"
                    onClick={() => setResetting(u)}
                  >
                    비밀번호 초기화
                  </button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <UserDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        open={editing !== null}
        user={editing === 'new' ? null : editing}
        departments={(departments.data ?? []).filter((d) => d.active)}
        onClose={() => setEditing(null)}
      />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </div>
  );
}
