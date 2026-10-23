import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { BatchSummary } from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, PageHeader } from '@/components/PageHeader';
import { ProcessingBanner } from '@/components/ProcessingBanner';
import { Button } from '@/components/ui/Button';
import { FormError, Input, Select } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { cn, formatDateTime, formatNumber } from '@/lib/format';
import { uploadFile } from '@/upload/uploadFile';

type ItemState =
  | { kind: 'waiting' }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'done'; pages: number; skipped: number }
  | { kind: 'duplicate'; fileName: string; batchId: number }
  | { kind: 'error'; message: string };

interface UploadItem {
  key: string;
  file: File;
  state: ItemState;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function ItemStatus({ state }: { state: ItemState }) {
  switch (state.kind) {
    case 'waiting':
      return <span className="text-ink-faint">기다리는 중</span>;
    case 'uploading':
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-paper" role="progressbar" aria-valuenow={state.done} aria-valuemax={state.total}>
            <div className="h-full bg-navy transition-[width]" style={{ width: `${(state.done / Math.max(state.total, 1)) * 100}%` }} />
          </div>
          <span className="tabular-nums text-ink-soft">
            {state.done}/{state.total}쪽
          </span>
        </div>
      );
    case 'done':
      return (
        <span className="text-ok">
          올림 · {state.pages}쪽{state.skipped > 0 && ` (앞서 올린 ${state.skipped}쪽은 건너뜀)`}
        </span>
      );
    case 'duplicate':
      return <span className="text-warn">이미 올린 파일이라 건너뜀 (묶음 #{state.batchId})</span>;
    case 'error':
      return <span className="text-seal">{state.message}</span>;
  }
}

export function UploadPage() {
  const queryClient = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [title, setTitle] = useState('');
  const [batchId, setBatchId] = useState<number | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reprocessing, setReprocessing] = useState<{ batch: BatchSummary; busy: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const batches = useQuery({
    queryKey: ['batches'],
    queryFn: () => api.get<BatchSummary[]>('/batches'),
    refetchInterval: (query) => (query.state.data?.some((b) => b.pagesWaiting > 0) ? 3000 : false),
  });
  const continuing = batches.data?.find((b) => b.id === batchId);

  function update(key: string, state: ItemState) {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, state } : item)));
  }

  async function start(files: File[]) {
    if (files.length === 0 || busy) return;
    const added = files.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, file, state: { kind: 'waiting' } as ItemState }));
    setItems((list) => [...list, ...added]);
    setBusy(true);
    setError(null);
    try {
      // 처음 올릴 때 묶음을 만든다. 같은 화면에서 더 올리면 같은 묶음에 넣는다
      let id = batchId;
      if (id === null) {
        id = (await api.post<{ id: number }>('/batches', { year, title: title.trim() || null })).id;
        setBatchId(id);
      }
      for (const item of added) {
        update(item.key, { kind: 'uploading', done: 0, total: 1 });
        try {
          const outcome = await uploadFile(id, item.file, (done, total) => update(item.key, { kind: 'uploading', done, total }));
          if (outcome.kind === 'duplicate') update(item.key, { kind: 'duplicate', fileName: outcome.fileName, batchId: outcome.batchId });
          else if (outcome.skipped === outcome.pages) update(item.key, { kind: 'duplicate', fileName: item.file.name, batchId: id });
          else update(item.key, outcome);
        } catch (err) {
          update(item.key, { kind: 'error', message: errorMessage(err) });
        }
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
        void queryClient.invalidateQueries({ queryKey: ['processing'] });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
    }
  }

  function drop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    setDragging(false);
    void start([...e.dataTransfer.files]);
  }

  // 파일을 이 화면 어디로 끌어와도 받는다: 끌어오는 동안 화면 전체가 받는 곳으로 바뀐다
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: globalThis.DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    function enter(e: globalThis.DragEvent) {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    }
    function leave(e: globalThis.DragEvent) {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    }
    function over(e: globalThis.DragEvent) {
      if (hasFiles(e)) e.preventDefault();
    }
    function reset() {
      dragDepth.current = 0;
      setDragging(false);
    }
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', reset);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', reset);
    };
  }, []);

  async function reprocess(batch: BatchSummary) {
    setReprocessing((r) => (r ? { ...r, busy: true } : r));
    try {
      const { queued } = await api.post<{ queued: number }>(`/batches/${batch.id}/reprocess`);
      toast.success(`${queued}쪽을 다시 읽습니다.`);
      void queryClient.invalidateQueries({ queryKey: ['batches'] });
      void queryClient.invalidateQueries({ queryKey: ['processing'] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setReprocessing(null);
    }
  }

  function newBatch() {
    setBatchId(null);
    setItems([]);
    setTitle('');
  }

  const doneCount = items.filter((i) => i.state.kind === 'done').length;

  return (
    <>
      <PageHeader
        title="이수증 올리기"
        description="걷은 이수증 PDF(여러 장을 한꺼번에 스캔한 파일도 됩니다)와 사진을 한꺼번에 올리세요. 쪽마다 나눠서 읽고, 읽은 것부터 검수함에 들어갑니다."
      />
      <ProcessingBanner />

      <section className="rounded-2xl border border-line bg-sheet px-6 py-5 shadow-surface">
        {batchId === null ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-[13.5px]">
              <span className="mb-1.5 block font-semibold">대상 연도</span>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
                {[thisYear, thisYear - 1].map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
            </label>
            <label className="block min-w-0 flex-1 text-[13.5px]">
              <span className="mb-1.5 block font-semibold">메모 (선택)</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 상반기 폭력예방교육 제출분" maxLength={100} />
            </label>
            <p className="w-full text-[12.5px] text-ink-faint">
              이수일이 대상 연도와 다르면 검수할 때 확인 표시가 붙습니다.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13.5px]">
            <p>
              <span className="font-medium">묶음 #{batchId}</span>
              <span className="ml-2 text-ink-soft">
                {continuing ? `${continuing.year}년${continuing.title ? ` · ${continuing.title}` : ''}` : `${year}년${title ? ` · ${title}` : ''}`}에 이어서 올립니다.
              </span>
            </p>
            <Button size="sm" onClick={newBatch} disabled={busy}>
              새 묶음으로 올리기
            </Button>
          </div>
        )}
      </section>

      <label
        htmlFor="cert-files"
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
        className={cn(
          'group mt-4 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-sheet px-6 py-14 text-center transition-colors',
          'border-line-strong hover:border-navy/50 hover:bg-navy-soft/40',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-navy-soft text-navy transition-transform duration-200 group-hover:-translate-y-0.5">
          <FileUp className="size-7" aria-hidden />
        </span>
        <span className="text-[17px] font-bold">{busy ? '올리는 중입니다. 창을 닫지 마세요.' : '이수증 파일을 끌어다 놓거나 눌러서 고르세요'}</span>
        <span className="text-[14px] text-ink-faint">PDF, JPG, PNG를 여러 개 한 번에 올릴 수 있고, 스캔 묶음 PDF는 쪽마다 나눠서 읽습니다</span>
        <input
          ref={inputRef}
          id="cert-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void start([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </label>
      {dragging && !busy && (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-navy/10 p-6 backdrop-blur-[2px]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={drop}
        >
          <div className="animate-pop-in pointer-events-none grid w-full max-w-xl place-items-center gap-3 rounded-3xl border-2 border-dashed border-navy bg-sheet/95 px-8 py-16 text-center shadow-float">
            <span className="grid size-16 place-items-center rounded-2xl bg-navy text-white">
              <FileUp className="size-8" aria-hidden />
            </span>
            <p className="text-[20px] font-bold">놓으면 바로 올립니다</p>
            <p className="text-[14px] text-ink-soft">{batchId === null ? `${year}년 이수증으로 올립니다` : `묶음 #${batchId}에 이어서 올립니다`}</p>
          </div>
        </div>
      )}

      <div className="mt-4">
        <FormError message={error} />
      </div>

      {items.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">
              이번에 올린 파일 <span className="font-normal text-ink-soft">{doneCount}/{items.length}</span>
            </h2>
            {batchId !== null && !busy && doneCount > 0 && (
              <Link to={`/review?batch=${batchId}`} className="text-[13.5px] font-medium text-link hover:underline">
                이 묶음 검수하기
              </Link>
            )}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>파일</Th>
                <Th className="w-20 text-right">크기</Th>
                <Th className="w-80">상태</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.key}>
                  <Td className="max-w-0 truncate font-medium" title={item.file.name}>
                    {item.file.name}
                  </Td>
                  <Td className="text-right text-ink-soft tabular-nums">{formatSize(item.file.size)}</Td>
                  <Td className="text-[13px]">
                    <ItemStatus state={item.state} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-2 text-[15px] font-semibold">올린 묶음</h2>
        {batches.data && batches.data.length === 0 ? (
          <EmptyState title="아직 올린 이수증이 없습니다" description="위 칸에 이수증 파일을 끌어다 놓으면 묶음이 만들어집니다." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-16">묶음</Th>
                <Th className="min-w-40">메모</Th>
                <Th className="w-20">연도</Th>
                <Th className="w-28 text-right">쪽</Th>
                <Th className="w-40">검수</Th>
                <Th className="w-36">올린 사람·시각</Th>
                <Th className="w-0">
                  <span className="sr-only">관리</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {(batches.data ?? []).map((b) => (
                <Tr key={b.id}>
                  <Td className="text-ink-soft tabular-nums">#{b.id}</Td>
                  <Td className="font-medium">{b.title ?? <span className="font-normal text-ink-faint">메모 없음</span>}</Td>
                  <Td>{b.year}년</Td>
                  <Td className="text-right tabular-nums">
                    {b.pages < b.pagesExpected ? (
                      <span className="text-warn" title="올리다 끊긴 파일이 있습니다. 같은 파일을 이 묶음에 다시 올리면 빠진 쪽부터 이어 올립니다.">
                        {formatNumber(b.pages)}/{formatNumber(b.pagesExpected)}
                      </span>
                    ) : (
                      formatNumber(b.pages)
                    )}
                  </Td>
                  <Td className="text-[13px]">
                    <div className="flex flex-wrap gap-1">
                      {b.pagesWaiting > 0 && <Tag tone="navy">읽는 중 {b.pagesWaiting}</Tag>}
                      {b.pagesError > 0 && <Tag tone="seal">읽기 실패 {b.pagesError}</Tag>}
                      {b.drafts > 0 && <Tag tone="warn">검수 대기 {b.drafts}</Tag>}
                      {b.confirmed > 0 && <Tag tone="ok">확정 {b.confirmed}</Tag>}
                      {b.excluded > 0 && <Tag>제외 {b.excluded}</Tag>}
                    </div>
                  </Td>
                  <Td className="text-[13px] text-ink-soft">
                    {b.createdBy}
                    <br />
                    {formatDateTime(b.createdAt)}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Link to={`/review?batch=${b.id}`} className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft">
                      검수
                    </Link>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft disabled:text-ink-faint"
                      disabled={b.drafts === 0 || b.pagesWaiting > 0}
                      onClick={() => setReprocessing({ batch: b, busy: false })}
                    >
                      다시 읽기
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-[13px] text-link hover:bg-navy-soft disabled:text-ink-faint"
                      disabled={busy}
                      onClick={() => {
                        setBatchId(b.id);
                        setItems([]);
                        inputRef.current?.click();
                      }}
                    >
                      더 올리기
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <ConfirmDialog
        open={reprocessing !== null}
        title={`묶음 #${reprocessing?.batch.id ?? ''} 다시 읽기`}
        description={
          <>
            검수 대기 이수증 {formatNumber(reprocessing?.batch.drafts ?? 0)}건을 다시 읽습니다. 확정·제외한 이수증은 그대로 둡니다.
            <br />
            검수 대기 중에 고쳐 둔 값은 새로 읽은 값으로 바뀝니다.
          </>
        }
        confirmLabel="다시 읽기"
        busy={reprocessing?.busy}
        onConfirm={() => reprocessing && void reprocess(reprocessing.batch)}
        onClose={() => setReprocessing(null)}
      />
    </>
  );
}
