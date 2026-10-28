import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  CERTIFICATE_STATUS_LABELS,
  type BatchSummary,
  type BulkConfirmResult,
  type BulkExcludePreview,
  type BulkExcludeResult,
  type CertificateDetail,
  type CertificateInput,
  type CertificateListItem,
  type CertificateStatus,
  type Employee,
  type ReviewResetPreview,
  type ReviewResetResult,
  type Training,
} from '@shared/types.ts';
import { shortTrainingName } from '@shared/trainingNames.ts';
import { matchesReviewSearch } from '@shared/reviewSearch.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { withBase } from '@/lib/base';
import { ProcessingBanner, useProcessing } from '@/components/ProcessingBanner';
import { Button, buttonClass } from '@/components/ui/Button';
import { FormError, Input, Select } from '@/components/ui/Field';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import type { EditGuard } from '@/lib/unsavedChanges';
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
  if (item.status === 'excluded') return <span className="size-2 shrink-0 rounded-full bg-ink-faint" title="제외 완료 · 현황에 합산하지 않음" />;
  if (item.flags.some((f) => f.level === 'error')) return <span className="size-2 shrink-0 rounded-full bg-seal" title="고칠 점 있음" />;
  if (item.flags.some((f) => f.level === 'warning')) return <span className="size-2 shrink-0 rounded-full bg-warn" title="확인할 점 있음" />;
  return <span className="size-2 shrink-0 rounded-full bg-ok" title="확인할 점 없음" />;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

export function ReviewPage() {
  const queryClient = useQueryClient();
  const editGuard = useOutletContext<EditGuard>();
  const [params, setParams] = useSearchParams();
  const batchId = Number(params.get('batch')) || null;
  const status = (params.get('status') as CertificateStatus | null) ?? 'draft';
  const onlyFlagged = params.get('flagged') === '1';
  const search = params.get('q')?.trim() ?? '';
  const [searchText, setSearchText] = useState(search);
  const selectionScope = JSON.stringify([batchId, status, onlyFlagged, search]);
  const [selection, setSelection] = useState<{ scope: string; ids: Set<number> }>({ scope: selectionScope, ids: new Set() });
  const [bulkExclusion, setBulkExclusion] = useState<{ preview: BulkExcludePreview; scopeLabel: string } | null>(null);
  const [bulkExcludeBusy, setBulkExcludeBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestBusyRef = useRef(false);
  const mountedRef = useRef(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [excluding, setExcluding] = useState<{ input: CertificateInput; dirty: boolean } | null>(null);
  const [savedDraft, setSavedDraft] = useState<{ id: number; input: CertificateInput } | null>(null);
  const [hasEdits, setHasEdits] = useState(false);
  const [bulk, setBulk] = useState<{ busy: boolean; ids: number[]; scopeLabel: string } | null>(null);
  const [resetPreview, setResetPreview] = useState<ReviewResetPreview | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; editGuard.clearPendingEdits(); };
  }, [editGuard]);

  const processing = useProcessing();
  const stillReading = (processing.data?.waiting ?? 0) + (processing.data?.running ?? 0) > 0;
  const batches = useQuery({ queryKey: ['batches'], queryFn: () => api.get<BatchSummary[]>('/batches'), refetchInterval: stillReading ? 3000 : false });
  const list = useQuery({
    queryKey: ['certificates', { batchId }],
    queryFn: () => api.get<CertificateListItem[]>(`/certificates${batchId ? `?batchId=${batchId}` : ''}`),
    refetchInterval: stillReading ? 3000 : false,
  });
  const trainings = useQuery({ queryKey: ['trainings'], queryFn: () => api.get<Training[]>('/trainings') });
  const employees = useQuery({ queryKey: ['employees'], queryFn: () => api.get<Employee[]>('/employees') });

  const all = list.data ?? [];
  const trainingNames = useMemo(() => new Map((trainings.data ?? []).map(t => [t.id, t.name])), [trainings.data]);
  const counts = useMemo(
    () => Object.fromEntries((['draft', 'confirmed', 'excluded'] as const).map((s) => [s, all.filter((c) => c.status === s).length])),
    [all],
  ) as Record<CertificateStatus, number>;
  const visible = useMemo(
    () => all.filter((c) => c.status === status && (!onlyFlagged || c.flags.some((f) => f.level !== 'info')) && matchesReviewSearch(c, search, trainingNames)),
    [all, status, onlyFlagged, search, trainingNames],
  );
  const clean = useMemo(() => visible.filter(isClean), [visible]);
  const selectable = visible.filter(c => c.status !== 'excluded' && !c.reading);
  const chosen = selectable.filter(c => selection.scope === selectionScope && selection.ids.has(c.id));
  const chosenIds = new Set(chosen.map(c => c.id));
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;
  const requested = Number(params.get('id')) || null;
  const currentId = requested && visible.some((c) => c.id === requested) ? requested : (visible[0]?.id ?? null);
  const scopedBatches = (batches.data ?? []).filter(b => !batchId || b.id === batchId);
  const readingPages = scopedBatches.reduce((n, b) => n + b.pagesWaiting, 0);
  const failedPages = scopedBatches.reduce((n, b) => n + b.pagesError, 0);
  const storedPages = scopedBatches.reduce((n, b) => n + b.pages, 0);
  const missingResults = scopedBatches.reduce((n, b) => n + Math.max(0, b.pages - b.drafts - b.confirmed - b.excluded - b.pagesWaiting - b.pagesError), 0);
  const emptyStoredResults = status === 'draft' && counts.draft === 0 && missingResults > 0 && readingPages === 0 && failedPages === 0;
  const scopeYear = scopedBatches[0]?.year ?? new Date().getFullYear();
  const canReset = counts.draft + readingPages + failedPages > 0;
  const nextId = visible[visible.findIndex(c => c.id === currentId) + 1]?.id ?? null;

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

  async function run(task: () => Promise<CertificateDetail>, done: (result: CertificateDetail, canNavigate: boolean) => void) {
    if (requestBusyRef.current || busy) return false;
    requestBusyRef.current = true;
    // 렌더/효과를 기다리지 않고 요청 시작과 동시에 외부 이동·새로고침을 보호한다.
    editGuard.setPendingEdits({ dirty: hasEdits, busy: true, save: async () => false, discard: () => {} });
    setBusy(true);
    setFormError(null);
    try {
      const result = await task();
      if (!mountedRef.current) return true;
      queryClient.setQueryData(['certificate', result.id], result);
      await queryClient.invalidateQueries({ queryKey: ['certificates'] });
      if (!mountedRef.current) return true;
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['status'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      const canNavigate = !editGuard.hasPendingNavigation();
      requestBusyRef.current = false;
      setBusy(false);
      editGuard.clearPendingEdits();
      done(result, canNavigate);
      return true;
    } catch (err) {
      if (mountedRef.current) setFormError(errorMessage(err));
      return false;
    } finally {
      requestBusyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  const actions = {
    discard: (input: CertificateInput) => setSavedDraft({ id: currentId!, input }),
    save: (input: CertificateInput, next = false) => {
      const id = currentId!;
      return run(() => api.put<CertificateDetail>(`/certificates/${id}`, input), (_result, canNavigate) => {
        setSavedDraft({ id, input });
        toast.success('수정값을 임시 저장했습니다. 아직 이수 현황에는 반영하지 않습니다.');
        if (canNavigate && next && nextId !== null) select(nextId);
      });
    },
    confirm: (input: CertificateInput) => {
      const id = currentId!;
      const next = nextAfter(id);
      return run(() => api.post<CertificateDetail>(`/certificates/${id}/confirm`, input), (result, canNavigate) => {
        toast.success(`${result.employee?.name ?? ''} 이수증을 확정했습니다.`);
        if (canNavigate) select(next);
      });
    },
    exclude: (input: CertificateInput, dirty: boolean) => setExcluding({ input, dirty }),
    reopen: () =>
      run(() => api.post<CertificateDetail>(`/certificates/${currentId}/reopen`), (_result, canNavigate) => {
        toast.success('검수 대기로 되돌렸습니다.');
        if (canNavigate) setParam({ status: 'draft' });
      }),
  };

  function exclude(reason: string, saveEdits: boolean) {
    const id = currentId!;
    const next = nextAfter(id);
    const pending = excluding!;
    setExcluding(null);
    void run(async () => {
      if (saveEdits && pending.dirty) await api.put<CertificateDetail>(`/certificates/${id}`, pending.input);
      return api.post<CertificateDetail>(`/certificates/${id}/exclude`, { reason });
    }, (_result, canNavigate) => {
      toast.success('제외했습니다.');
      if (canNavigate) select(next);
    });
  }

  async function bulkConfirm() {
    if (!bulk) return;
    setBulk({ ...bulk, busy: true });
    try {
      const result = await api.post<BulkConfirmResult>('/certificates/bulk-confirm', { ids: bulk.ids });
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

  async function prepareReset(scope = batchId) {
    setResetBusy(true);
    try {
      const preview = await api.get<ReviewResetPreview>(`/certificates/reset-preview${scope ? `?batchId=${scope}` : ''}`);
      setResetPreview(preview.pages ? preview : null);
      if (!preview.pages) toast.info('초기화할 검수 대기가 없습니다. 확정·제외 기록은 유지됩니다.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setResetBusy(false);
    }
  }

  async function resetDrafts() {
    if (!resetPreview) return;
    setResetBusy(true);
    try {
      const result = await api.post<ReviewResetResult>('/certificates/reset-drafts', {
        token: resetPreview.token,
        ...(resetPreview.batchId ? { batchId: resetPreview.batchId } : {}),
      });
      setResetPreview(null);
      setFormError(null);
      editGuard.clearPendingEdits();
      setParam({ id: null, status: 'draft' });
      await queryClient.invalidateQueries();
      toast.success(`검수 대기 ${formatNumber(result.removed)}건을 초기화했습니다(관련 ${formatNumber(result.resetPages)}쪽). 확정·제외 기록은 유지했습니다.`);
    } catch (err) {
      toast.error(errorMessage(err));
      if (err instanceof ApiError && err.status === 409) await prepareReset(resetPreview.batchId);
    } finally {
      setResetBusy(false);
    }
  }

  // 단축키: ↑↓ 이동, Ctrl+Enter 확정, X 제외
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.querySelector('dialog[open]')) return;
      if (busy) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (isTyping(e.target) && !(e.target as HTMLElement).closest('#certificate-form')) return;
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
        document.querySelector<HTMLButtonElement>('#certificate-exclude')?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, excluding, detail.data?.status, busy]);

  const current = detail.data && detail.data.id === currentId ? detail.data : null;

  // 마지막 행이 사라지면 폼의 busy=false 효과가 실행될 수 없다. 페이지가 남은 요청 보호를 정리한다.
  useEffect(() => {
    if (!busy && !current && !hasEdits) editGuard.clearPendingEdits();
  }, [busy, current, hasEdits, editGuard]);

  // 마지막 판독이 끝나면 3초 폴링이 먼저 취소될 수 있다. 종료 상태를 확인할 때 최종 결과를 다시 읽는다.
  useEffect(() => {
    if (!processing.data || stillReading) return;
    void queryClient.invalidateQueries({ queryKey: ['certificates'] });
    void queryClient.invalidateQueries({ queryKey: ['batches'] });
  }, [processing.dataUpdatedAt, stillReading, queryClient]);

  useEffect(() => { setSearchText(search); }, [search]);
  useEffect(() => { setSelection({ scope: selectionScope, ids: new Set() }); }, [selectionScope]);
  useEffect(() => { setFormError(null); }, [currentId]);

  function toggleSelection(id: number, checked: boolean) {
    setSelection(previous => {
      const ids = previous.scope === selectionScope ? new Set(previous.ids) : new Set<number>();
      if (checked) ids.add(id); else ids.delete(id);
      return { scope: selectionScope, ids };
    });
  }

  function finishBulkRequest() {
    if (!mountedRef.current) return;
    setBusy(false);
    setBulkExcludeBusy(false);
    // 선택 제외는 미저장 입력이 없을 때만 시작한다. 혹시 남은 입력이 있으면 폼의 보호를 유지한다.
    if (!hasEdits) editGuard.clearPendingEdits();
  }

  async function prepareBulkExclude() {
    if (!chosen.length || hasEdits || busy) return;
    setBulkError(null);
    const ids = chosen.map(c => c.id);
    const scopeLabel = `${batchId ? `묶음 #${batchId}` : '모든 묶음'} · ${CERTIFICATE_STATUS_LABELS[status]}${search ? ` · 검색: ${search}` : ''}${onlyFlagged ? ' · 확인할 점만' : ''}`;
    setBusy(true); setBulkExcludeBusy(true);
    try {
      const preview = await api.post<BulkExcludePreview>('/certificates/bulk-exclude-preview', { ids });
      setBulkExclusion({ preview, scopeLabel });
    } catch (err) {
      setBulkError(errorMessage(err));
      toast.error(errorMessage(err));
      await queryClient.invalidateQueries({ queryKey: ['certificates'] });
    } finally { finishBulkRequest(); }
  }

  async function excludeSelected(reason: string) {
    if (!bulkExclusion || hasEdits) return;
    setBusy(true); setBulkExcludeBusy(true);
    try {
      const result = await api.post<BulkExcludeResult>('/certificates/bulk-exclude', {
        ids: bulkExclusion.preview.ids, token: bulkExclusion.preview.token, reason,
      });
      setBulkError(null);
      setBulkExclusion(null);
      setSelection({ scope: selectionScope, ids: new Set() });
      setFormError(null);
      await queryClient.invalidateQueries();
      if (!mountedRef.current) return;
      const canNavigate = !editGuard.hasPendingNavigation();
      finishBulkRequest();
      if (canNavigate) setParam({ id: null });
      toast.success(`선택한 ${formatNumber(result.excluded)}건을 제외했습니다. 원본과 기존 연결 정보는 보존했습니다.`);
    } catch (err) {
      setBulkError(errorMessage(err));
      toast.error(errorMessage(err));
      // 재판독으로 사라진 ID나 전송 결과를 알 수 없는 실패도 새 미리보기로 다시 확인한다.
      setBulkExclusion(null);
      await queryClient.invalidateQueries();
    } finally { finishBulkRequest(); }
  }

  return (
    <>
      <PageHeader
        title="검수함"
        description="수료증 원본과 읽은 값을 대조한 뒤 확정하세요. 임시 저장은 검수 대기로 보관하고, 확정하면 이수 현황에 반영합니다."
        actions={
          <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-72"
            value={batchId ?? ''}
            disabled={busy}
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
          <Button variant="ghost" loading={resetBusy} disabled={busy || !canReset} title={canReset ? '선택한 범위의 대기 결과만 비웁니다' : '비울 검수 대기나 읽기 작업이 없습니다'} onClick={() => void prepareReset()}>
            검수 대기 초기화
          </Button>
          </div>
        }
      />
      <ProcessingBanner />

      {bulkError && <div className="mb-4"><FormError message={bulkError} /><Button size="sm" variant="ghost" onClick={() => setBulkError(null)}>안내 닫기</Button></div>}
      <form role="search" aria-label="검수함 검색" className="mb-3 flex flex-wrap items-center gap-2" onSubmit={e => {
        e.preventDefault(); setParam({ q: searchText.trim() || null, id: null });
      }}>
        <label htmlFor="review-search" className="sr-only">직원·교육명·파일명 검색</label>
        <Input id="review-search" type="search" maxLength={200} value={searchText} onChange={e => setSearchText(e.target.value)}
          placeholder="직원·사번·교육명·과정명·파일명 검색" className="min-w-60 flex-1" disabled={busy} />
        <Button type="submit" disabled={busy}>검색</Button>
        {(search || searchText) && <Button disabled={busy} onClick={() => { setSearchText(''); setParam({ q: null, id: null }); }}>검색 초기화</Button>}
        <span className="text-[13px] text-ink-soft" role="status">검색 결과 {formatNumber(visible.length)}건{search ? ` · ${search}` : ''}</span>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl bg-ink/[0.05] p-1" role="tablist">
          {(['draft', 'confirmed', 'excluded'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              disabled={busy}
              onClick={() => setParam({ status: s, id: null, flagged: null })}
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
        {status === 'draft' && <label className="flex items-center gap-2 text-[13.5px] text-ink-soft">
          <input type="checkbox" className="size-4 accent-navy" checked={onlyFlagged} disabled={busy} onChange={(e) => setParam({ flagged: e.target.checked ? '1' : null, id: null })} />
          확인할 점이 있는 것만
        </label>}
        {status === 'draft' && clean.length > 0 && (
          <Button className="ml-auto" disabled={busy || hasEdits || clean.length > 500} title={hasEdits ? '수정값을 임시 저장한 뒤 일괄 확정해 주세요' : undefined} onClick={() => setBulk({ busy: false, ids: clean.map(c => c.id), scopeLabel: `${batchId ? `묶음 #${batchId}` : '모든 묶음'}${search ? ` · 검색: ${search}` : ''}` })}>
            정상 {formatNumber(clean.length)}건 일괄 확정
          </Button>
        )}
      </div>

      {status !== 'excluded' && <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-navy" aria-label="현재 검색 결과 전체 선택" checked={allSelected}
            disabled={busy || selectable.length === 0 || selectable.length > 500}
            ref={element => { if (element) element.indeterminate = chosen.length > 0 && !allSelected; }}
            onChange={e => setSelection({ scope: selectionScope, ids: new Set(e.target.checked ? selectable.map(c => c.id) : []) })} />
          현재 검색 결과 전체 선택
        </label>
        <span role="status" className="font-semibold text-ink-soft">{formatNumber(chosen.length)}건 선택</span>
        {chosen.length > 0 && <Button size="sm" disabled={busy} onClick={() => setSelection({ scope: selectionScope, ids: new Set() })}>선택 해제</Button>}
        <Button size="sm" variant="danger" className="ml-auto" loading={bulkExcludeBusy} disabled={!chosen.length || busy || hasEdits}
          title={hasEdits ? '현재 수정값을 임시 저장한 뒤 선택 제외해 주세요' : '선택한 수료증만 사유를 확인한 뒤 제외합니다'} onClick={() => void prepareBulkExclude()}>
          선택 {formatNumber(chosen.length)}건 제외
        </Button>
        {(hasEdits || selectable.length > 500 || visible.some(c => c.reading)) && <p className="w-full text-[12px] text-ink-soft">
          {hasEdits ? '현재 수정값을 임시 저장하면 선택 제외를 사용할 수 있습니다.' : selectable.length > 500 ? '한 번에 500건까지 선택할 수 있습니다. 검색으로 범위를 좁혀 주세요.' : '다시 읽는 중인 수료증은 판독이 끝난 뒤 선택할 수 있습니다.'}
        </p>}
      </div>}

      {list.isPending ? <LoadingRows /> : list.isError ? (
        <EmptyState title="검수함을 불러오지 못했습니다" description={errorMessage(list.error)} action={<Button onClick={() => void list.refetch()}>다시 불러오기</Button>} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={search ? '검색 조건에 맞는 수료증이 없습니다' : readingPages ? '수료증을 읽고 있습니다' : failedPages ? '읽기에 실패한 쪽을 확인해 주세요' : emptyStoredResults ? '검수 결과가 비어 있습니다' : status === 'draft' && counts.draft === 0 && all.length > 0 ? '검수가 끝났습니다' : onlyFlagged && counts.draft > 0 ? '확인할 점이 남은 수료증이 없습니다' : status === 'confirmed' ? '확정한 수료증이 없습니다' : status === 'excluded' ? '제외한 수료증이 없습니다' : '올린 수료증이 없습니다'}
          description={search ? `'${search}' 검색어와 묶음·상태 범위를 확인해 주세요. 검색하지 않은 자료는 변경되지 않습니다.` : readingPages ? `읽는 중인 ${formatNumber(readingPages)}쪽은 판독이 끝나면 검수 대기에 나타납니다.` : failedPages ? `${formatNumber(failedPages)}쪽의 읽기에 실패했습니다. 올린 묶음에서 확인한 뒤 다시 읽어 주세요.` : emptyStoredResults ? `원본 ${formatNumber(storedPages)}쪽 중 ${formatNumber(missingResults)}쪽의 검수 결과가 없습니다. 확정 ${formatNumber(counts.confirmed)}건·제외 ${formatNumber(counts.excluded)}건은 보존되어 있습니다. 올린 묶음에서 ‘다시 읽기’를 누르면 비어 있는 결과를 다시 만들 수 있습니다.` : status === 'draft' && counts.draft === 0 && all.length > 0 ? `확정 ${formatNumber(counts.confirmed)}건 · 제외 ${formatNumber(counts.excluded)}건. 확정한 수료증은 이수 현황과 내보내기에 반영됩니다.` : onlyFlagged && counts.draft > 0 ? '필터를 해제하면 정상 수료증을 확인하고 확정할 수 있습니다.' : '수료증을 올리고 검수하면 이곳에서 처리 상태를 확인할 수 있습니다.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {search ? <Button variant="primary" onClick={() => setParam({ q: null, id: null })}>검색 초기화</Button> : onlyFlagged && counts.draft > 0 ? <Button variant="primary" onClick={() => setParam({ flagged: null })}>필터 해제</Button> : counts.confirmed > 0 ? <>
                <Link to={`/status?year=${scopeYear}`} className={buttonClass('primary')}>이수 현황 보기</Link>
                <Link to={`/export?year=${scopeYear}`} className={buttonClass()}>내보내기</Link>
              </> : null}
              <Link to={emptyStoredResults || failedPages ? '/upload#uploaded-batches' : '/upload'} className={buttonClass(counts.confirmed > 0 ? 'ghost' : 'primary')}>{emptyStoredResults ? '올린 묶음에서 다시 읽기' : failedPages ? '올린 묶음 확인' : '수료증 올리기'}</Link>
            </div>
          }
        />
      ) : (
        <div className="grid h-[calc(100dvh-400px)] min-h-[320px] grid-cols-[minmax(200px,250px)_minmax(0,1fr)_minmax(340px,400px)] gap-4">
          <ul className="min-h-0 space-y-0.5 overflow-y-auto rounded-xl border border-line bg-sheet p-1.5" aria-label="이수증 목록">
            {visible.map((c) => (
              <li key={c.id} className="flex items-center gap-0.5">
                {status !== 'excluded' && <input type="checkbox" className="ml-1 size-4 shrink-0 accent-navy"
                  aria-label={`수료증 #${c.id} ${c.employee?.name ?? c.personName ?? '직원 미정'} ${c.fileName} 선택`}
                  checked={chosenIds.has(c.id)}
                  disabled={busy || c.reading || (chosen.length >= 500 && !chosenIds.has(c.id))}
                  onChange={e => toggleSelection(c.id, e.target.checked)} />}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => select(c.id)}
                  aria-current={c.id === currentId}
                  className={cn(
                    'flex min-w-0 flex-1 gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    c.id === currentId ? 'bg-navy-soft ring-1 ring-navy/20' : 'hover:bg-paper',
                  )}
                  title={`${c.employee?.name ?? c.personName ?? '이름 없음'} · ${c.courseTitle ?? '과정명 미정'} · ${c.fileName}`}
                >
                  <img src={withBase(`/api/pages/${c.pageId}/thumb`)} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded-[5px] border border-line object-cover object-top" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                      <FlagDot item={c} />
                      <span className="truncate">{c.employee?.name ?? c.personName ?? '이름 없음'}</span>
                    </span>
                    <span className="block truncate text-[12.5px] text-ink-soft">{trainingSummary(c.trainingIds, trainings.data ?? [])}</span>
                    <span className="block truncate text-[12px] text-ink-faint">
                      {c.reading ? '다시 읽는 중…' : `${c.completedOn ?? '이수일 없음'} · ${c.fileName}${c.pageCount > 1 ? ` · ${c.pageNo}/${c.pageCount}쪽` : ''}`}
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
                savedInput={savedDraft?.id === current.id ? savedDraft.input : undefined}
                hasNext={nextId !== null}
                onDirtyChange={setHasEdits}
              />
            </>
          ) : (
            <div className="col-span-2 grid place-items-center rounded-xl border border-dashed border-line-strong text-[13px] text-ink-faint">
              {currentId === null ? '왼쪽 목록에서 이수증을 고르세요.' : '불러오는 중…'}
            </div>
          )}
        </div>
      )}
      <ExcludeDialog key={excluding ? `exclude-${currentId}` : 'closed'} open={excluding !== null} fileName={current?.fileName ?? ''} hasEdits={excluding?.dirty ?? false} onClose={() => setExcluding(null)} onExclude={exclude} />
      <ExcludeDialog key={bulkExclusion?.preview.token ?? 'bulk-closed'} open={bulkExclusion !== null} preview={bulkExclusion?.preview}
        scopeLabel={bulkExclusion?.scopeLabel} busy={bulkExcludeBusy} onClose={() => { if (!bulkExcludeBusy) setBulkExclusion(null); }}
        onExclude={reason => void excludeSelected(reason)} />
      <ConfirmDialog
        open={resetPreview !== null}
        title="검수 대기 초기화"
        description={resetPreview && (
          <div className="space-y-3">
            <p><strong>{resetPreview.scopeLabel}</strong>의 검수 대기 {formatNumber(resetPreview.drafts)}건과 미완료 읽기 {formatNumber(resetPreview.incompletePages)}쪽을 비웁니다.</p>
            <p>대기 자료에 입력한 수정값도 지워집니다. 확정·제외 기록, 직원·교육과정, 원본 파일은 유지됩니다.</p>
            <p>원본을 다시 판독하려면 &lsquo;올린 묶음&rsquo;에서 &lsquo;다시 읽기&rsquo;를 누르세요. 입력했던 수정값은 다시 작성해야 합니다.</p>
          </div>
        )}
        confirmLabel="대기만 초기화"
        confirmVariant="danger"
        busy={resetBusy}
        onConfirm={() => void resetDrafts()}
        onClose={() => { if (!resetBusy) setResetPreview(null); }}
      />
      <ConfirmDialog
        open={bulk !== null}
        title={`정상 ${formatNumber(bulk?.ids.length ?? 0)}건 일괄 확정`}
        description={
          <>
            고칠 점(빨강)과 확인할 점(주황)이 하나도 없는 현재 검색 결과의 검수 대기 수료증 {formatNumber(bulk?.ids.length ?? 0)}건을 한 번에 확정합니다
            {bulk ? ` (${bulk.scopeLabel})` : ''}.
            <br />
            스캔본은 이름·날짜를 원본과 대조하라는 안내(파랑)가 붙어 있을 수 있습니다. 확정한 뒤에도 &lsquo;검수 대기로 되돌리기&rsquo;로 고칠 수 있습니다.
          </>
        }
        confirmLabel={`${formatNumber(bulk?.ids.length ?? 0)}건 확정`}
        busy={bulk?.busy}
        onConfirm={() => void bulkConfirm()}
        onClose={() => setBulk(null)}
      />
    </>
  );
}
