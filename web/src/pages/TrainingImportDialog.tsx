import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Plus } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import type { TrainingDocumentPreview, TrainingImportDraft } from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select, Textarea } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { extractPdfText } from '@/upload/renderPages';

type Row = TrainingImportDraft & { selected: boolean };
const blank = (): Row => ({ name: '', category: null, legalBasis: null, reqType: null, reqValue: null, keywords: [], fromYear: null, toYear: null, note: null, source: '', warnings: [], selected: true });

export function TrainingImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TrainingDocumentPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [errorAttempt, setErrorAttempt] = useState(0);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = rows.filter(r => r.selected);
  const busy = reading || saving;
  const busyRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [replacement, setReplacement] = useState<File | null>(null);

  function update(index: number, patch: Partial<Row>) {
    setRows(previous => previous.map((row, i) => i === index ? { ...row, ...patch } : row));
  }

  async function read(file: File) {
    if (busyRef.current) return;
    setError(null); setPreview(null); setRows([]);
    if (!/\.(pdf|hwpx|jpe?g|png)$/i.test(file.name)) { setError('PDF·HWPX 문서 또는 JPG·JPEG·PNG 사진을 골라 주세요.'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('20MB 이하의 파일을 골라 주세요.'); return; }
    busyRef.current = true;
    setReading(true);
    try {
      const body = new FormData();
      if (/\.pdf$/i.test(file.name)) body.append('textLayer', await extractPdfText(file));
      body.append('file', file);
      const result = await api.post<TrainingDocumentPreview>('/trainings/import/parse', body);
      setPreview(result);
      setRows(result.drafts.map(d => ({ ...d, selected: !d.duplicateId })));
    } catch (err) { setError(errorMessage(err)); }
    finally { busyRef.current = false; setReading(false); }
  }

  async function save(): Promise<boolean> {
    if (busyRef.current) return false;
    setErrorAttempt(previous => previous + 1);
    if (!preview || !selected.length) return false;
    if (selected.some(r => !r.name.trim() || !r.reqType || !r.reqValue || r.reqValue <= 0)) {
      setError('선택한 교육의 이름과 이수 기준을 모두 입력해 주세요.'); return false;
    }
    if (selected.some(r => r.reqValue! > 1000 || (r.reqType === 'count' && !Number.isInteger(r.reqValue)))) { setError('횟수는 1 이상의 정수, 시간은 0보다 큰 수로 입력해 주세요. 기준 값은 1000 이하여야 합니다.'); return false; }
    busyRef.current = true;
    setSaving(true); setError(null);
    try {
      const result = await api.post<{ created: number }>('/trainings/import/apply', {
        fileName: preview.fileName,
        trainings: selected.map(({ name, category, legalBasis, reqType, reqValue, keywords, fromYear, toYear, note }) =>
          ({ name, category, legalBasis, reqType, reqValue, keywords, fromYear, toYear, note })),
      });
      toast.success(`교육 ${result.created}개를 등록했습니다.`);
      await queryClient.invalidateQueries({ queryKey: ['trainings'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      onClose();
      return true;
    } catch (err) { setError(errorMessage(err)); return false; }
    finally { busyRef.current = false; setSaving(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void save(); }
  function requestClose() { formRef.current?.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); }

  return <><Dialog open={open} onClose={onClose} dismissible={!busy} dirty={preview !== null} busy={busy} onSave={save} width="lg" title="교육 기준표 가져오기"
    description="교육 목록·계획표·안내 사진에서 교육명과 연간 시간·횟수를 읽습니다. 개인 수료증을 증빙으로 등록할 때는 ‘수료증 올리기’를 이용하세요. 읽은 기준은 기관 지침과 확인한 뒤 등록합니다.">
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
      <Field label="교육 기준표 문서 또는 사진" htmlFor="training-document" hint="PDF·HWPX·JPG·JPEG·PNG, 20MB 이하. PDF는 100쪽, 사진은 4,000만 화소 이하. 사진·스캔 PDF는 OCR로 읽으며, 파일은 외부로 전송하지 않습니다.">
        <Input id="training-document" type="file" accept=".pdf,.hwpx,.jpg,.jpeg,.png,image/jpeg,image/png" disabled={busy} className="h-auto py-2" onChange={e => { const file = e.target.files?.[0]; if (file) { if (preview) setReplacement(file); else void read(file); } e.target.value = ''; }} />
      </Field>
      {reading && <p role="status" className="rounded-lg bg-navy-soft p-4 text-[14px] text-navy"><FileUp className="mr-2 inline size-4" aria-hidden />문서·사진을 읽고 있습니다. 사진의 크기와 PDF 쪽 수에 따라 시간이 걸립니다.</p>}
      <FormError message={error} attentionKey={errorAttempt} />
      {preview && <>
        <div className="space-y-1 rounded-lg bg-paper p-3 text-[13px] text-ink-soft">
          <p className="font-semibold text-ink">{preview.fileName} · 교육 {rows.length}개</p>
          {preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[14px]">
          <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-navy" checked={rows.length > 0 && selected.length === rows.length}
            ref={el => { if (el) el.indeterminate = selected.length > 0 && selected.length !== rows.length; }}
            onChange={e => setRows(previous => previous.map(r => ({ ...r, selected: e.target.checked })))} />전체 선택 · {selected.length}개 선택</label>
          <Button size="sm" disabled={busy || rows.length >= 200} onClick={() => setRows(previous => [...previous, blank()])}><Plus className="size-4" aria-hidden />교육 직접 추가</Button>
        </div>
        {rows.map((row, i) => <section key={i} className="space-y-3 rounded-xl border border-line p-4">
          <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" className="size-4 accent-navy" checked={row.selected} onChange={e => update(i, { selected: e.target.checked })} />교육 {i + 1} 등록</label>
          {row.warnings.length > 0 && <p className="text-[12.5px] text-seal">{row.warnings.join(' ')}</p>}
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
            <Field label="교육 이름" htmlFor={`import-name-${i}`} required><Input id={`import-name-${i}`} value={row.name} maxLength={100} required={row.selected} onChange={e => update(i, { name: e.target.value })} /></Field>
            <Field label="연간 기준" htmlFor={`import-value-${i}`} required><Input id={`import-value-${i}`} type="number" min={row.reqType === 'count' ? 1 : 0.01} max={1000} step={row.reqType === 'count' ? 1 : 'any'} value={row.reqValue ?? ''} required={row.selected} onChange={e => update(i, { reqValue: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="기준 단위" htmlFor={`import-type-${i}`} required><Select id={`import-type-${i}`} value={row.reqType ?? ''} required={row.selected} onChange={e => update(i, { reqType: e.target.value === 'hours' ? 'hours' : e.target.value === 'count' ? 'count' : null })}>
              <option value="">확인 필요</option><option value="hours">시간</option><option value="count">회</option>
            </Select></Field>
          </div>
          <Field label="근거 법령" htmlFor={`import-basis-${i}`}><Input id={`import-basis-${i}`} maxLength={300} value={row.legalBasis ?? ''} onChange={e => update(i, { legalBasis: e.target.value || null })} /></Field>
          <details className="text-[13px] text-ink-soft"><summary className="cursor-pointer py-1">원문·분류·키워드·적용 연도</summary>
            <pre className="my-3 max-h-36 overflow-auto rounded bg-paper p-3 font-sans text-[12.5px] whitespace-pre-wrap">{row.source || '직접 추가한 교육입니다.'}</pre>
            <div className="space-y-3">
              <Field label="분류" htmlFor={`import-category-${i}`}><Input id={`import-category-${i}`} maxLength={50} value={row.category ?? ''} onChange={e => update(i, { category: e.target.value || null })} /></Field>
              <Field label="인식 키워드 (쉼표로 구분)" htmlFor={`import-keywords-${i}`}><Input id={`import-keywords-${i}`} defaultValue={row.keywords.join(', ')} onBlur={e => update(i, { keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) })} /></Field>
              <div className="grid grid-cols-2 gap-3">{(['fromYear', 'toYear'] as const).map((field, n) => <Field key={field} label={n ? '적용 종료 연도' : '적용 시작 연도'} htmlFor={`import-${field}-${i}`}><Input id={`import-${field}-${i}`} type="number" min={2000} max={2100} value={row[field] ?? ''} onChange={e => update(i, { [field]: e.target.value ? Number(e.target.value) : null })} /></Field>)}</div>
              <Field label="메모" htmlFor={`import-note-${i}`}><Textarea id={`import-note-${i}`} maxLength={500} value={row.note ?? ''} onChange={e => update(i, { note: e.target.value || null })} /></Field>
            </div>
          </details>
        </section>)}
        <details className="text-[13px] text-ink-soft"><summary className="cursor-pointer">문서에서 읽은 전체 글 보기</summary><pre className="mt-2 max-h-64 overflow-auto rounded bg-paper p-3 font-sans whitespace-pre-wrap">{preview.text || '읽을 수 있는 글자가 없습니다.'}</pre></details>
      </>}
      <DialogActions><Button disabled={busy} onClick={requestClose}>취소</Button><Button type="submit" variant="primary" loading={saving} disabled={reading || !selected.length}>선택한 교육 {selected.length}개 등록</Button></DialogActions>
      </fieldset>
    </form>
  </Dialog>
    <ConfirmDialog open={replacement !== null} title="다른 파일을 읽을까요?" description="현재 기준표에서 고친 값과 선택한 내용은 버립니다. 계속 편집하려면 취소하세요." confirmLabel="다른 파일 읽기" confirmVariant="danger" onClose={() => setReplacement(null)} onConfirm={() => { const file = replacement; setReplacement(null); if (file) void read(file); }} />
  </>;
}
