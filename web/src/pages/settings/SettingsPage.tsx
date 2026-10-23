import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';
import { AccessLogTab } from './AccessLogTab';
import { AuditTab } from './AuditTab';
import { BackupTab } from './BackupTab';
import { DepartmentsTab } from './DepartmentsTab';
import { SystemTab } from './SystemTab';
import { UsersTab } from './UsersTab';

const TABS = [
  { key: 'departments', label: '부서' },
  { key: 'users', label: '사용자 계정' },
  { key: 'org', label: '기관 정보' },
  { key: 'audit', label: '감사 로그' },
  { key: 'access', label: '접속기록' },
  { key: 'backup', label: '백업·보관' },
  { key: 'system', label: '시스템 점검' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function OrgTab() {
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: ['settings', 'org'], queryFn: () => api.get<{ name: string }>('/settings/org') });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.put('/settings/org', { name: new FormData(e.currentTarget).get('name') });
      toast.success('기관명을 저장했습니다.');
      await queryClient.invalidateQueries({ queryKey: ['meta'] });
      await queryClient.invalidateQueries({ queryKey: ['settings', 'org'] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (org.isPending) return null;
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <FormError message={error} />
      <Field label="기관명" htmlFor="org-name" required hint="로그인 화면과 메뉴 위쪽, 내보내는 문서 제목에 쓰입니다.">
        <Input id="org-name" name="name" defaultValue={org.data?.name} required />
      </Field>
      <Button type="submit" variant="primary" loading={saving}>
        저장
      </Button>
    </form>
  );
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: TabKey = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as TabKey) : 'departments';

  return (
    <>
      <PageHeader title="설정" description="부서·계정·기관 정보와 보안·백업을 관리합니다. 바꾼 내용은 감사 로그에 남습니다." />
      <div className="mb-6 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams({ tab: t.key }, { replace: true })}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-[14px] transition-colors',
              tab === t.key ? 'border-navy font-semibold text-ink' : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'departments' && <DepartmentsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'org' && <OrgTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'access' && <AccessLogTab />}
      {tab === 'backup' && <BackupTab />}
      {tab === 'system' && <SystemTab />}
    </>
  );
}
