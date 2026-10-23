import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { BackupStatus, PurgeCandidate, RetentionSettings, RetentionView } from '@shared/types.ts';
import { LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';

// 설정 > 백업·보관: 백업 상태와 "지금 백업", 보관기간, 보관기간이 지난 연도 파기

function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function Backups() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupStatus>('/backups') });
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const next = await api.post<BackupStatus>('/backups/run');
      queryClient.setQueryData(['backups'], next);
      void queryClient.invalidateQueries({ queryKey: ['system'] });
      if (next.last?.ok) toast.success(`백업했습니다: ${next.last.file}`);
      else toast.error(`백업 실패: ${next.last?.error}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  const data = status.data;
  return (
    <section className="rounded-md border border-line bg-sheet p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[72ch]">
          <h2 className="text-[16px] font-semibold">백업</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            매일 {data?.hour ?? 2}시(한국 시각)에 DB 사본을 만들고, 원본 파일·쪽 이미지는 바뀐 것만 복사합니다. 복원과 복원 연습은 서버의 <code>restore</code> 스크립트로 합니다(운영가이드 참고).
          </p>
          {data && <p className="mt-1 font-mono text-[12.5px] text-ink-faint">{data.dir}</p>}
        </div>
        <Button variant="primary" onClick={() => void run()} loading={running || data?.running}>
          지금 백업
        </Button>
      </div>
      {!data ? (
        <LoadingRows />
      ) : (
        <div className="mt-3 space-y-3">
          {data.last ? (
            <p className={`flex items-start gap-2 text-[13.5px] ${data.last.ok ? 'text-ok' : 'text-seal'}`}>
              {data.last.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <span>
                마지막 백업 {formatDateTime(data.last.at)} —{' '}
                {data.last.ok
                  ? `${data.last.file} · 파일 ${formatNumber(data.last.copiedFiles)}개 복사${data.last.removedFiles ? ` · 파기된 파일 ${formatNumber(data.last.removedFiles)}개 정리` : ''} · ${Math.max(1, Math.round(data.last.ms / 1000))}초`
                  : `실패: ${data.last.error}`}
              </span>
            </p>
          ) : (
            <p className="text-[13.5px] text-warn">아직 백업한 적이 없습니다. "지금 백업"으로 백업 폴더에 쓸 수 있는지 확인해 주세요.</p>
          )}
          {data.snapshots.length > 0 && (
            <details className="text-[13px]">
              <summary className="cursor-pointer text-ink-soft">DB 사본 {formatNumber(data.snapshots.length)}개</summary>
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border border-line font-mono text-[12.5px]">
                {data.snapshots.map((s) => (
                  <li key={s.file} className="flex justify-between border-b border-line px-3 py-1 last:border-b-0">
                    <span>{s.file}</span>
                    <span className="text-ink-faint">{size(s.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

const FIELDS: { key: keyof RetentionSettings; label: string; unit: string; hint: string }[] = [
  { key: 'documentYears', label: '이수증 자료', unit: '년', hint: '원본 파일·쪽 이미지·이수 기록. 다음 해 1월 1일부터 셉니다. 기관 기록물 관리 지침에 맞추세요.' },
  { key: 'accessLogYears', label: '접속기록', unit: '년', hint: '최소 2년. 지나면 서버가 매일 스스로 지웁니다.' },
  { key: 'auditLogYears', label: '감사 로그', unit: '년', hint: '계정·권한 변경 이력이 들어 있어 최소 3년.' },
  { key: 'backupKeep', label: 'DB 백업본', unit: '개', hint: '하루 1개씩 쌓이므로 30이면 30일치. 파기한 자료도 이 기간이 지나면 백업에서 사라집니다.' },
];

function Retention({ view }: { view: RetentionView }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RetentionSettings>(view.settings);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(view.settings), [view.settings]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      queryClient.setQueryData(['retention'], await api.put<RetentionView>('/retention', form));
      toast.success('보관기간을 저장했습니다.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-sheet p-5">
      <h2 className="text-[16px] font-semibold">보관기간</h2>
      <FormError message={error} />
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label} (${f.unit})`} htmlFor={`ret-${f.key}`} hint={f.hint}>
            <Input
              id={`ret-${f.key}`}
              type="number"
              className="w-28"
              min={view.minimum[f.key]}
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: Number(e.target.value) })}
            />
          </Field>
        ))}
      </div>
      <Button type="submit" variant="primary" className="mt-4" loading={saving}>
        저장
      </Button>
    </form>
  );
}

function Purge({ view }: { view: RetentionView }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<PurgeCandidate | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function purge() {
    if (!target) return;
    setBusy(true);
    try {
      const result = await api.post<PurgeCandidate & { fileErrors: number }>('/retention/purge', { year: target.year, confirm });
      toast.success(
        `${result.year}년 자료를 파기했습니다 (이수증 ${formatNumber(result.certificates)}건, 파일 ${formatNumber(result.files)}개${result.fileErrors ? `, 지우지 못한 파일 ${result.fileErrors}개` : ''}).`,
      );
      setTarget(null);
      setConfirm('');
      await queryClient.invalidateQueries();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-line bg-sheet p-5">
      <h2 className="text-[16px] font-semibold">보관기간이 지난 자료 파기</h2>
      <p className="mt-1 text-[13px] text-ink-soft">
        이수증 자료 보관기간({view.settings.documentYears}년)이 지난 연도입니다. 파기하면 그해의 원본 파일·쪽 이미지·이수 기록·대상 제외가 지워지고 되돌릴 수 없습니다. 필요하면 먼저 내보내기에서 현황 엑셀을 받아 두세요. 파기 내역은 감사 로그(파기 대장)에 남습니다.
      </p>
      {view.candidates.length === 0 ? (
        <p className="mt-3 text-[13.5px] text-ink-faint">파기할 연도가 없습니다. ({view.thisYear}년 기준)</p>
      ) : (
        <Table className="mt-3">
          <thead>
            <tr>
              <Th>대상 연도</Th>
              <Th className="text-right">이수증</Th>
              <Th className="text-right">원본 파일</Th>
              <Th className="text-right">쪽</Th>
              <Th className="text-right">대상 제외</Th>
              <Th className="text-right">함께 지울 퇴직자</Th>
              <Th className="text-right">용량</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {view.candidates.map((c) => (
              <Tr key={c.year}>
                <Td className="font-medium">{c.year}년</Td>
                <Td className="text-right">{formatNumber(c.certificates)}</Td>
                <Td className="text-right">{formatNumber(c.files)}</Td>
                <Td className="text-right">{formatNumber(c.pages)}</Td>
                <Td className="text-right">{formatNumber(c.exemptions)}</Td>
                <Td className="text-right">{formatNumber(c.retiredEmployees)}</Td>
                <Td className="text-right">{size(c.bytes)}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="danger" onClick={() => setTarget(c)}>
                    파기
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Dialog open={target !== null} onClose={() => setTarget(null)} title={`${target?.year}년 자료 파기`}>
        <div className="space-y-3 text-[14px] text-ink-soft">
          <p>
            이수증 {formatNumber(target?.certificates ?? 0)}건, 원본 파일 {formatNumber(target?.files ?? 0)}개, 쪽 {formatNumber(target?.pages ?? 0)}개
            {target?.retiredEmployees ? `, 퇴직자 ${formatNumber(target.retiredEmployees)}명` : ''}을 지웁니다. 되돌릴 수 없습니다.
          </p>
          <Field label={`확인을 위해 ${target?.year}을(를) 입력하세요`} htmlFor="purge-confirm">
            <Input id="purge-confirm" data-autofocus value={confirm} onChange={(e) => setConfirm(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>취소</Button>
          <Button variant="danger" loading={busy} disabled={confirm.trim() !== String(target?.year)} onClick={() => void purge()}>
            파기
          </Button>
        </DialogActions>
      </Dialog>
    </section>
  );
}

export function BackupTab() {
  const retention = useQuery({ queryKey: ['retention'], queryFn: () => api.get<RetentionView>('/retention') });
  return (
    <div className="space-y-6">
      <Backups />
      {retention.data ? (
        <>
          <Retention view={retention.data} />
          <Purge view={retention.data} />
        </>
      ) : (
        <LoadingRows />
      )}
    </div>
  );
}
