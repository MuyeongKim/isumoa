import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  CERTIFICATE_STATUS_LABELS,
  type BatchSummary,
  type BulkConfirmResult,
  type CertificateDetail,
  type CertificateInput,
  type CertificateListItem,
  type CertificateStatus,
  type Employee,
  type Training,
} from '@shared/types.ts';
import { shortTrainingName } from '@shared/trainingNames.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { ProcessingBanner, useProcessing } from '@/components/ProcessingBanner';
import { Button, buttonClass } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { CertificateForm } from './CertificateForm';
import { ExcludeDialog } from './ExcludeDialog';
import { PageViewer } from './PageViewer';

/** 목록에 쓰는 짧은 교육 이름: "성희롱 예방교육" → "성희롱" */
export { shortTrainingName };

function trainingSummary(ids: number[], trainings: Training[]): string {
  const names = trainings.filter((t) => ids.includes(t.id)).map((t) => shortTrainingName(t.name));
  if (names.length === 0) return '교육 미정';
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}` : names.join(', ');
}

/** 값을 읽은 방법 */
const ROUTE_LABELS: Record<string, string> = {
  text: 'PDF 글자',
  ocr: 'OCR',
};

/** 확인할 점이 안내(파랑)뿐인 이수증 = 일괄 확정 대상 (다시 읽는 중인 것은 빼고) */
function isClean(c: CertificateListItem): boolean {
  return c.status === 'draft' && !c.reading && c.flags.every((f) => f.level === 'info');
}

function FlagDot({ item }: { item: CertificateListItem }) {
  if (item.flags.some((f) => f.level === 'error')) return <span className="size-2 shrink-0 rounded-full bg-seal" title="고칠 점 있음" />;
  if (item.flags.some((f) => f.level === 'warning')) return <span className="size-2 shrink-0 rounded-full bg-warn" title="확인할 점 있음" />;
  return <span className="size-2 shrink-0 rounded-full bg-ok" title="확인할 점 없음" />;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const batchId = Number(params.get('batch')) || null;
  const status = (params.get('status') as CertificateStatus | null) ?? 'draft';
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState(false);
  const [bulk, setBulk] = useState<{ busy: boolean } | null>(null);

  const processing = useProcessing();
  const stillReading = (processing.data?.waiting ?? 0) + (processing.data?.running ?? 0) > 0;
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.get<BatchSummary[]>('/batches') });
  const list = useQuery({
    queryKey: ['certificates', { batchId }],
    queryFn: () => api.get<CertificateListItem[]>(`/certificates${batchId ? `?batchId=${batchId}` : ''}`),
    refetchInterval: stillReading ? 3000 : false,
  });
  const trainings = useQuery({ queryKey: ['trainings'], queryFn: () => api.get<Training[]>('/trainings') });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api.get<Employee[]>('/employees') });

  const all = list.data ?? [];
  const counts = useMemo(
    () => Object.fromEntries((['draft', 'confirmed', 'excluded'] as const).map((s) => [s, all.filter((c) => c.status === s).length])),
    [all],
  ) as Record<CertificateStatus, number>;
  const visible = useMemo(
    () => all.filter((c) => c.status === status && (!onlyFlagged || c.flags.some((f) => f.level !== 'info'))),
    [all, status, onlyFlagged],
  );
  const clean = useMemo(() => all.filter(isClean), [all]);
  const requested = Number(params.get('id')) || null;
  const currentId = requested && all.some((c) => c.id === requested) ? requested : (visible[0]?.id ?? null);

  const detail = useQuery({
    queryKey: ['certificate', currentId],
    queryFn: () => api.get<CertificateDetail>(`/certificates/${currentId}`),
    enabled: currentId !== null,
  });

  const setParam = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const select = useCallback((id: number | null) => {
    setFormError(null);
    setParam({ id: id === null ? null : String(id) });
  }, [setParam]);

  const move = useCallback(
    (offset: number) => {
      const index = visible.findIndex((c) => c.id === currentId);
      const next = visible[Math.min(Math.max(index + offset, 0), visible.length - 1)];
      if (next) select(next.id);
    },
    [visible, currentId, select],
  );

  /** 확정·제외한 뒤에는 같은 목록의 다음 이수증으로 넘어간다 */
  function nextAfter(id: number): number | null {
    const index = visible.findIndex((c) => c.id === id);
    return visible[index + 1]?.id ?? visible[index - 1]?.id ?? null;
  }

  async function run(task: () => Promise<CertificateDetail>, done: (result: CertificateDetail) => void) {
    setBusy(true);
    setFormError(null);
    try {
      const result = await task();
      queryClient.setQueryData(['certificate', result.id], result);
      await queryClient.invalidateQueries({ queryKey: ['certificates'] });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      done(result);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const actions = {
    save: (input: CertificateInput) =>
      run(() => api.put<CertificateDetail>(`/certificates/${currentId}`, input), () => toast.success('저장했습니다.')),
    confirm: (input: CertificateInput) => {
      const id = currentId!;
      const next = nextAfter(id);
      return run(() => api.post<CertificateDetail>(`/certificates/${id}/confirm`, input), (result) => {
        toast.success(`${result.employee?.name ?? ''} 이수증을 확정했습니다.`);
        select(next);
      });
    },
    exclude: () => setExcluding(true),
    reopen: () =>
      run(() => api.post<CertificateDetail>(`/certificates/${currentId}/reopen`), () => {
        toast.success('검수 대기로 되돌렸습니다.');
        setParam({ status: 'draft' });
      }),
  };

  function exclude(reason: string) {
    const id = currentId!;
    const next = nextAfter(id);
    setExcluding(false);
    void run(() => api.post<CertificateDetail>(`/certificates/${id}/exclude`, { reason }), () => {
      toast.success('제외했습니다.');
      select(next);
    });
  }

  async function bulkConfirm() {
    setBulk({ busy: true });
    try {
      const result = await api.post<BulkConfirmResult>('/certificates/bulk-confirm', { ids: clean.map((c) => c.id) });
      await queryClient.invalidateQueries({ queryKey: ['certificates'] });
      await queryClient.invalidateQueries({ queryKey: ['certificate'] });
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      toast.success(
        `${formatNumber(result.confirmed)}건을 확정했습니다.${result.skipped.length ? ` ${formatNumber(result.skipped.length)}건은 그사이 확인할 점이 생겨 남겨 두었습니다.` : ''}`,
      );
      select(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBulk(null);
    }
  }

  // 단축키: ↑↓ 이동, Ctrl+Enter 확정, X 제외
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.querySelector<HTMLFormElement>('#certificate-form')?.requestSubmit();
        return;
      }
      if (isTyping(e.target) || excluding || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        move(-1);
      } else if ((e.key === 'x' || e.key === 'X') && detail.data?.status === 'draft') {
        setExcluding(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, excluding, detail.data?.status]);

  const current = detail.data && detail.data.id === currentId ? detail.data : null;

  return (
    <>
      <PageHeader
        title="검수함"
        description="왼쪽에서 이수증을 고르고, 원본과 읽은 값을 대조한 뒤 확정하세요. ↑↓ 이동 · Ctrl+Enter 확정 · X 제외"
        actions={
          <Select
            className="w-72"
            value={batchId ?? ''}
            aria-label="묶음"
            onChange={(e) => setParam({ batch: e.target.value || null, id: null })}
          >
            <option value="">모든 묶음</option>
            {(batches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                #{b.id} {b.year}년{b.title ? ` · ${b.title}` : ''} ({formatNumber(b.drafts)}건 대기)
              </option>
            ))}
          </Select>
        }
      />
      <ProcessingBanner />

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl bg-ink/[0.05] p-1" role="tablist">
          {(['draft', 'confirmed', 'excluded'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setParam({ status: s, id: null })}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-[14px] font-semibold whitespace-nowrap transition-colors',
                status === s ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_27_38/0.12)]' : 'text-ink-soft hover:text-ink',
              )}
            >
              {CERTIFICATE_STATUS_LABELS[s]}{' '}
              <span className={cn('tabular-nums', status === s && s === 'draft' ? 'text-navy' : 'text-ink-faint')}>{formatNumber(counts[s] ?? 0)}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13.5px] text-ink-soft">
          <input type="checkbox" className="size-4 accent-navy" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
          확인할 점이 있는 것만
        </label>
        {status === 'draft' && clean.length > 0 && (
          <Button className="ml-auto" onClick={() => setBulk({ busy: false })}>
            정상 {formatNumber(clean.length)}건 일괄 확정
          </Button>
        )}
      </div>

      {list.isSuccess && all.length === 0 ? (
        <EmptyState
          title="검수할 이수증이 없습니다"
          description="이수증을 올리면 쪽마다 읽어서 이곳에 넣습니다."
          action={
            <Link to="/upload" viewTransition className={buttonClass('primary')}>
              이수증 올리기
            </Link>
          }
        />
      ) : (
        <div className="grid h-[calc(100vh-250px)] min-h-[560px] grid-cols-[minmax(200px,250px)_minmax(0,1fr)_minmax(340px,400px)] gap-4">
          <ul className="min-h-0 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-sheet p-1.5" aria-label="이수증 목록">
            {visible.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => select(c.id)}
                  aria-current={c.id === currentId}
                  className={cn(
                    'flex w-full gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    c.id === currentId ? 'bg-navy-soft ring-1 ring-navy/20' : 'hover:bg-paper',
                  )}
                >
                  <img src={`/api/pages/${c.pageId}/thumb`} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded-[5px] border border-line object-cover object-top" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                      <FlagDot item={c} />
                      <span className="truncate">{c.employee?.name ?? c.personName ?? '이름 없음'}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-soft">{trainingSummary(c.trainingIds, trainings.data ?? [])}</span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {c.reading ? '다시 읽는 중…' : `${c.completedOn ?? '이수일 없음'} · ${c.pageCount > 1 ? `${c.pageNo}/${c.pageCount}쪽` : c.fileName}`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-4 py-10 text-center text-[13px] text-ink-faint">해당하는 이수증이 없습니다.</li>}
          </ul>

          {current ? (
            <>
              <PageViewer
                pageId={current.pageId}
                pageText={current.pageText}
                caption={`${current.fileName}${current.pageCount > 1 ? ` · ${current.pageNo}/${current.pageCount}쪽` : ''}${current.route ? ` · ${ROUTE_LABELS[current.route] ?? current.route}` : ''}`}
              />
              <CertificateForm
                key={`${current.id}-${current.status}`}
                detail={current}
                trainings={trainings.data ?? []}
                employees={employees.data ?? []}
                busy={busy}
                error={formError}
                actions={actions}
              />
            </>
          ) : (
            <div className="col-span-2 grid place-items-center rounded-xl border border-dashed border-line-strong text-[13px] text-ink-faint">
              {currentId === null ? '왼쪽 목록에서 이수증을 고르세요.' : '불러오는 중…'}
            </div>
          )}
        </div>
      )}
      <ExcludeDialog open={excluding} onClose={() => setExcluding(false)} onExclude={exclude} />
      <ConfirmDialog
        open={bulk !== null}
        title={`정상 ${formatNumber(clean.length)}건 일괄 확정`}
        description={
          <>
            고칠 점(빨강)과 확인할 점(주황)이 하나도 없는 검수 대기 이수증 {formatNumber(clean.length)}건을 한 번에 확정합니다
            {batchId ? ` (묶음 #${batchId})` : ' (모든 묶음)'}.
            <br />
            스캔본은 이름·날짜를 원본과 대조하라는 안내(파랑)가 붙어 있을 수 있습니다. 확정한 뒤에도 &lsquo;검수 대기로 되돌리기&rsquo;로 고칠 수 있습니다.
          </>
        }
        confirmLabel={`${formatNumber(clean.length)}건 확정`}
        busy={bulk?.busy}
        onConfirm={() => void bulkConfirm()}
        onClose={() => setBulk(null)}
      />
    </>
  );
}
