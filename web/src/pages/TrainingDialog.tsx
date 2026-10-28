import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { ReqType, Training } from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input, Textarea } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';

/** 인식 키워드 입력: Enter나 쉼표로 하나씩 추가한다 */
function KeywordInput({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function commit() {
    const words = draft
      .split(',')
      .map((w) => w.trim())
      .filter((w) => w && !value.includes(w));
    if (words.length) onChange([...value, ...words]);
    setDraft('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-sheet px-2 py-1.5 focus-within:border-link focus-within:ring-2 focus-within:ring-link/20">
      {value.map((word) => (
        <span key={word} className="inline-flex items-center gap-1 rounded bg-navy-soft px-1.5 py-0.5 text-[13px] text-navy">
          {word}
          <button
            type="button"
            aria-label={`${word} 빼기`}
            className="rounded text-navy/60 hover:text-navy"
            onClick={() => onChange(value.filter((w) => w !== word))}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={value.length ? '' : '예: 청렴, 부패방지'}
        className="min-w-24 flex-1 bg-transparent px-1 text-[14px] outline-none"
        aria-label="인식 키워드 추가"
      />
    </div>
  );
}

function yearOrNull(value: FormDataEntryValue | null): number | null {
  const n = Number(value);
  return value && Number.isInteger(n) ? n : null;
}

export function TrainingDialog({ open, training, onClose, onImport }: { open: boolean; training: Training | null; onClose: () => void; onImport?: () => void }) {
  const queryClient = useQueryClient();
  const [reqType, setReqType] = useState<ReqType>(training?.reqType ?? 'count');
  const [keywords, setKeywords] = useState<string[]>(training?.keywords ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);
  async function save(): Promise<boolean> {
    if (savingRef.current || !formRef.current?.reportValidity()) return false;
    const form = new FormData(formRef.current);

    const body = {
      name: String(form.get('name')),
      category: String(form.get('category') ?? '').trim() || null,
      legalBasis: String(form.get('legalBasis') ?? '').trim() || null,
      reqType,
      reqValue: Number(form.get('reqValue')),
      keywords,
      fromYear: yearOrNull(form.get('fromYear')),
      toYear: yearOrNull(form.get('toYear')),
      note: String(form.get('note') ?? '').trim() || null,
    };
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (training) await api.patch(`/trainings/${training.id}`, body);
      else await api.post('/trainings', body);
      toast.success(training ? `${body.name}을(를) 저장했습니다.` : `${body.name}을(를) 추가했습니다.`);
      await queryClient.invalidateQueries({ queryKey: ['trainings'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      setDirty(false);
      onClose();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void save(); }
  function requestClose() { formRef.current?.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })); }

  return (<>
    <Dialog open={open} onClose={onClose} title={training ? '교육 기준 수정' : '교육 기준 추가'} width="lg" dirty={dirty} busy={saving} onSave={save}>
      <form ref={formRef} onSubmit={submit} onChange={() => setDirty(true)} className="space-y-4">
        <fieldset disabled={saving} className="space-y-4">
        <FormError message={error} />
        {!training && onImport && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper p-3 text-[13px] text-ink-soft"><span>교육 목록이 담긴 문서나 JPG·JPEG·PNG 사진이 있나요?</span><Button size="sm" onClick={() => dirty ? setConfirmImport(true) : onImport()}>교육 기준표 가져오기</Button></div>}
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="교육 이름" htmlFor="tr-name" required>
            <Input id="tr-name" name="name" defaultValue={training?.name} required autoFocus />
          </Field>
          <Field label="분류" htmlFor="tr-category" hint="예: 폭력예방, 청렴">
            <Input id="tr-category" name="category" defaultValue={training?.category ?? ''} />
          </Field>
        </div>
        <Field label="근거 법령" htmlFor="tr-basis">
          <Input id="tr-basis" name="legalBasis" defaultValue={training?.legalBasis ?? ''} />
        </Field>
        <fieldset>
          <legend className="text-[13px] font-medium">
            이수 기준<span className="ml-0.5 text-seal">*</span>
          </legend>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[14px]">연</span>
            <Input
              name="reqValue"
              type="number"
              min={reqType === 'count' ? 1 : 0.01}
              max={1000}
              step={reqType === 'count' ? 1 : 'any'}
              defaultValue={training?.reqValue ?? 1}
              required
              className="w-20"
              aria-label="기준 값"
            />
            <div className="inline-flex overflow-hidden rounded-lg border border-line-strong" role="radiogroup" aria-label="기준 단위">
              {(
                [
                  ['count', '회'],
                  ['hours', '시간'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={reqType === value}
                  onClick={() => { setReqType(value); setDirty(true); }}
                  className={cn('h-10 px-4 text-[14.5px] font-semibold transition-colors', reqType === value ? 'bg-navy text-white' : 'bg-sheet hover:bg-paper')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[14px]">이상</span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-ink-faint">
            시간 기준이면 같은 해 이수증의 교육시간을 더해서 판단합니다. 예: 청렴교육 1시간짜리 2장 → 2시간
          </p>
        </fieldset>
        <Field
          label="인식 키워드"
          hint="이수증의 과정명에 이 단어가 있으면 이 교육으로 분류합니다. 띄어쓰기는 무시합니다. ‘긴급·안전·교육’처럼 여러 주제에 겹치는 단어만으로는 자동 분류하지 않습니다. 여러 교육에 같은 단어를 넣으면 통합과정 한 장으로 함께 인정합니다."
        >
          <KeywordInput value={keywords} onChange={value => { setKeywords(value); setDirty(true); }} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="적용 시작 연도" htmlFor="tr-from" hint="비워 두면 제한 없음">
            <Input id="tr-from" name="fromYear" type="number" min={2000} max={2100} defaultValue={training?.fromYear ?? ''} />
          </Field>
          <Field label="적용 종료 연도" htmlFor="tr-to" hint="폐지된 교육이면 마지막 연도">
            <Input id="tr-to" name="toYear" type="number" min={2000} max={2100} defaultValue={training?.toYear ?? ''} />
          </Field>
        </div>
        <Field label="메모" htmlFor="tr-note">
          <Textarea id="tr-note" name="note" defaultValue={training?.note ?? ''} rows={2} />
        </Field>
        <DialogActions>
          <Button disabled={saving} onClick={requestClose}>취소</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {training ? '저장' : '추가'}
          </Button>
        </DialogActions>
        </fieldset>
      </form>
    </Dialog>
    <ConfirmDialog open={confirmImport} title="입력을 버리고 기준표를 가져올까요?" description="직접 입력한 내용은 저장되지 않습니다. 계속 편집하려면 취소하세요." confirmLabel="버리고 기준표 가져오기" confirmVariant="danger" onClose={() => setConfirmImport(false)} onConfirm={() => { setConfirmImport(false); onImport?.(); }} />
  </>);
}
