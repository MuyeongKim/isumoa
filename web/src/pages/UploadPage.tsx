import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useLocation } from 'react-router';
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
import { isZip, readArchive, ZIP_LIMITS, type ArchiveResult } from '@/upload/readArchive';

type ItemState =
  | { kind: 'waiting' }
  | { kind: 'uploading'; done: number; total: number }
  | { kind: 'done'; pages: number; skipped: number }
  | { kind: 'duplicate'; fileName: string; batchId: number }
  | { kind: 'error'; message: string };

interface UploadItem {
  key: string;
  file: File | null;
  name: string;
  size: number;
  source?: string;
  state: ItemState;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function reprocessablePages(batch: BatchSummary): number {
  return Math.max(0, batch.pages - batch.confirmed - batch.excluded);
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
  const { hash } = useLocation();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [title, setTitle] = useState('');
  const [batchId, setBatchId] = useState<number | null>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [unpacking, setUnpacking] = useState<string | null>(null);
  const [archives, setArchives] = useState<(Omit<ArchiveResult, 'files'> & { count: number; error?: string })[]>([]);
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

  useEffect(() => {
    if (hash !== '#uploaded-batches') return;
    const heading = document.getElementById('uploaded-batches');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [hash, batches.isPending]);

  function update(key: string, state: ItemState) {
    setItems((list) => list.map((item) => (item.key === key ? { ...item, state, file: ['done', 'duplicate', 'error'].includes(state.kind) ? null : item.file } : item)));
  }

  async function start(files: File[]) {
    if (files.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const added: UploadItem[] = [];
      let archiveFiles = 0, archiveBytes = 0;
      for (const file of files) {
        if (isZip(file)) {
          setUnpacking(file.name);
          try {
            const result = await readArchive(file, (path, done, total) => setUnpacking(`${file.name} · ${done}/${total}개 · ${path}`), { files: ZIP_LIMITS.files - archiveFiles, bytes: ZIP_LIMITS.totalBytes - archiveBytes });
            archiveFiles += result.files.length; archiveBytes += result.files.reduce((n, entry) => n + entry.file.size, 0);
            setArchives(list => [...list, { name: result.name, count: result.files.length, skipped: result.skipped }]);
            for (const entry of result.files) added.push({ key: crypto.randomUUID(), file: entry.file, name: entry.file.name, size: entry.file.size, source: `${file.name} / ${entry.path}`, state: { kind: 'waiting' } });
          } catch (err) {
            setArchives(list => [...list, { name: file.name, count: 0, skipped: [], error: errorMessage(err) }]);
          }
        } else added.push({ key: crypto.randomUUID(), file, name: file.name, size: file.size, state: { kind: 'waiting' } });
      }
      setUnpacking(null);
      setItems(list => [...list, ...added]);
      if (added.length === 0) return;
      // 처음 올릴 때 묶음을 만든다. 같은 화면에서 더 올리면 같은 묶음에 넣는다
      let id = batchId;
      if (id === null) {
        id = (await api.post<{ id: number }>('/batches', { year, title: title.trim() || null })).id;
        setBatchId(id);
      }
      for (const item of added) {
        const file = item.file!;
        update(item.key, { kind: 'uploading', done: 0, total: 1 });
        try {
          const outcome = await uploadFile(id, file, (done, total) => update(item.key, { kind: 'uploading', done, total }));
          if (outcome.kind === 'duplicate') update(item.key, { kind: 'duplicate', fileName: outcome.fileName, batchId: outcome.batchId });
          else if (outcome.skipped === outcome.pages) update(item.key, { kind: 'duplicate', fileName: item.name, batchId: id });
          else update(item.key, outcome);
        } catch (err) {
          update(item.key, { kind: 'error', message: errorMessage(err) });
        }
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
        void queryClient.invalidateQueries({ queryKey: ['processing'] });
      }
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setItems(list => list.map(item => item.state.kind === 'waiting' ? { ...item, file: null, state: { kind: 'error', message } } : item));
    } finally {
      busyRef.current = false;
      setUnpacking(null);
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
    setArchives([]);
    setTitle('');
  }

  const doneCount = items.filter((i) => i.state.kind === 'done').length;
  const duplicateCount = items.filter(i => i.state.kind === 'duplicate').length;
  const failedCount = items.filter(i => i.state.kind === 'error').length;
  const finishedCount = doneCount + duplicateCount + failedCount;

  return (
    <>
      <PageHeader
        title="수료증 올리기"
        description="직원이 받은 수료증 PDF(여러 장을 한꺼번에 스캔한 파일도 됩니다)와 사진, 또는 이 파일들을 모은 ZIP을 한꺼번에 올리세요. 쪽마다 나눠서 읽고, 읽은 것부터 검수함에 들어갑니다."
      />
      <ProcessingBanner />

      <section className="rounded-2xl border border-line bg-sheet px-6 py-5 shadow-surface">
        {batchId === null ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="block text-[13.5px]">
              <span className="mb-1.5 block font-semibold">대상 연도</span>
              <Select value={year} disabled={busy} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
                {[thisYear, thisYear - 1].map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </Select>
            </label>
            <label className="block min-w-0 flex-1 text-[13.5px]">
              <span className="mb-1.5 block font-semibold">메모 (선택)</span>
              <Input value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="예: 상반기 폭력예방교육 제출분" maxLength={100} />
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
        <span className="text-[17px] font-bold">{busy ? unpacking ? 'ZIP을 푸는 중입니다. 창을 닫지 마세요.' : '올리는 중입니다. 창을 닫지 마세요.' : '수료증 파일을 끌어다 놓거나 눌러서 고르세요'}</span>
        <span className="text-[14px] text-ink-faint">PDF·JPG·JPEG·PNG·ZIP을 선택하면 바로 읽기를 시작합니다. 교육 목록·기준표는 ‘교육 기준’에서 가져오세요.</span>
        <input
          ref={inputRef}
          id="cert-files"
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.zip,application/pdf,image/jpeg,image/png,application/zip,application/x-zip-compressed"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void start([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </label>
      <p className="mt-2 text-[12.5px] text-ink-faint">ZIP 안의 폴더도 찾습니다. ZIP 300MB 이하 · 수료증 1,000개 이하 · 압축 해제 합계 500MB 이하 · 개별 파일 100MB 이하. 암호 ZIP·RAR·7z는 직접 풀어 올려 주세요.</p>
      {unpacking && <p role="status" className="mt-3 break-all text-[13.5px] text-navy">압축 해제: {unpacking}</p>}
      {archives.length > 0 && <section className="mt-4 rounded-2xl border border-line bg-sheet p-4" aria-label="압축파일 처리 결과">
        <h2 className="text-[15px] font-semibold">압축파일 처리 결과</h2>
        {archives.map((archive, i) => <div key={i} className="mt-3 space-y-1 text-[13.5px]">
          <p className="break-all"><strong>{archive.name}</strong> · 꺼낸 파일 {archive.count}개 · 건너뜀 {archive.skipped.length}개</p>
          {archive.error && <p role="alert" className="text-seal">{archive.error}</p>}
          {!archive.error && archive.count === 0 && <p className="text-warn">읽을 수료증이 없습니다. ZIP 안의 파일과 건너뛴 사유를 확인하세요.</p>}
          {archive.skipped.length > 0 && <details><summary className="cursor-pointer text-link">건너뛴 파일과 사유 보기</summary><ul className="mt-2 max-h-60 space-y-1 overflow-auto text-ink-soft">{archive.skipped.map((entry, j) => <li key={j} className="break-all">{entry.path} — {entry.reason}</li>)}</ul></details>}
        </div>)}
      </section>}
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
              이번에 고른 파일 <span className="font-normal text-ink-soft">{finishedCount}/{items.length} 처리</span>
            </h2>
            {batchId !== null && !busy && doneCount > 0 && (
              <Link to={`/review?batch=${batchId}`} className="text-[13.5px] font-medium text-link hover:underline">
                이 묶음 검수하기
              </Link>
            )}
          </div>
          <p className="mb-2 text-[12.5px] text-ink-soft" role="status">올림 {doneCount}개 · 중복 {duplicateCount}개 · 실패 {failedCount}개</p>
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
                  <Td className="max-w-0 truncate font-medium" title={item.source ?? item.name}>
                    {item.name}{item.source && <span className="mt-0.5 block truncate text-[12px] font-normal text-ink-faint">{item.source}</span>}
                  </Td>
                  <Td className="text-right text-ink-soft tabular-nums">{formatSize(item.size)}</Td>
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
        <h2 id="uploaded-batches" tabIndex={-1} className="mb-2 scroll-mt-4 text-[15px] font-semibold">올린 묶음</h2>
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
                      disabled={reprocessablePages(b) === 0 || b.pagesWaiting > 0}
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
                        setArchives([]);
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
            확정·제외하지 않은 원본 {formatNumber(reprocessing ? reprocessablePages(reprocessing.batch) : 0)}쪽을 다시 읽습니다. 초기화한 검수 결과도 다시 만들며, 확정·제외한 이수증은 그대로 둡니다.
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
