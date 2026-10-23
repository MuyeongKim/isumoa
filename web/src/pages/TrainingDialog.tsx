import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import type { ReqType, Training } from '@shared/types.ts';
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

export function TrainingDialog({ open, training, onClose }: { open: boolean; training: Training | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reqType, setReqType] = useState<ReqType>(training?.reqType ?? 'count');
  const [keywords, setKeywords] = useState<string[]>(training?.keywords ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
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
    setSaving(true);
    setError(null);
    try {
      if (training) await api.patch(`/trainings/${training.id}`, body);
      else await api.post('/trainings', body);
      toast.success(training ? `${body.name}을(를) 저장했습니다.` : `${body.name}을(를) 추가했습니다.`);
      await queryClient.invalidateQueries({ queryKey: ['trainings'] });
      await queryClient.invalidateQueries({ queryKey: ['overview'] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={training ? '교육 과정 수정' : '교육 과정 추가'} width="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormError message={error} />
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
              min={0.5}
              step={0.5}
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
                  onClick={() => setReqType(value)}
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
          hint="이수증의 과정명에 이 단어가 있으면 이 교육으로 분류합니다. 띄어쓰기는 무시합니다. 여러 교육에 같은 단어를 넣으면 통합과정 한 장으로 함께 인정합니다."
        >
          <KeywordInput value={keywords} onChange={setKeywords} />
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
          <Button onClick={onClose}>취소</Button>
          <Button type="submit" variant="primary" loading={saving}>
            {training ? '저장' : '추가'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
