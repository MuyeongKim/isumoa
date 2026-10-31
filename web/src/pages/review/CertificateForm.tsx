import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router';
import type { CertificateDetail, CertificateFlag, CertificateInput, Employee, Training } from '@shared/types.ts';
import { certificateInputKey, certificateInputOf } from '@shared/certificateInput.ts';
import { ConfirmStamp } from '@/components/SealMark';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input } from '@/components/ui/Field';
import { cn, formatDateTime, requirementText } from '@/lib/format';
import { ReviewAssist } from './ReviewAssist';
import type { AssistSuggestion } from '@shared/reviewTools.ts';
import { EmployeePicker } from './EmployeePicker';
import type { EditGuard } from '@/lib/unsavedChanges';

const FLAG_STYLE = {
  error: { icon: CircleAlert, className: 'border-seal/30 bg-seal-soft text-seal' },
  warning: { icon: TriangleAlert, className: 'border-warn/30 bg-warn-soft text-warn' },
  info: { icon: Info, className: 'border-line bg-paper text-ink-soft' },
} as const;

export function FlagList({ flags }: { flags: CertificateFlag[] }) {
  if (flags.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <ul className="space-y-1.5">
      {[...flags]
        .sort((a, b) => order[a.level] - order[b.level])
        .map((f) => {
          const { icon: Icon, className } = FLAG_STYLE[f.level];
          return (
            <li key={f.code} className={cn('flex gap-2 rounded-md border px-3 py-2 text-[13px] leading-snug', className)}>
              <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{f.message}</span>
            </li>
          );
        })}
    </ul>
  );
}

function split(hours: string, count: number): string {
  const n = Number(hours);
  if (hours.trim() === '' || !Number.isFinite(n) || count === 0) return '';
  return String(Math.round((n / count) * 100) / 100);
}

export interface FormActions {
  discard: (input: CertificateInput) => void;
  save: (input: CertificateInput, next?: boolean) => Promise<boolean>;
  confirm: (input: CertificateInput) => Promise<boolean>;
  exclude: (input: CertificateInput, dirty: boolean) => void;
  reopen: () => Promise<boolean>;
}

export function CertificateForm({
  detail,
  trainings,
  employees,
  busy,
  error,
  actions,
  savedInput,
  hasNext,
  onDirtyChange,
}: {
  detail: CertificateDetail;
  trainings: Training[];
  employees: Employee[];
  busy: boolean;
  error: string | null;
  actions: FormActions;
  savedInput?: CertificateInput;
  hasNext: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const editGuard = useOutletContext<EditGuard>();
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const initialInput = useRef(certificateInputOf(detail));
  const readOnly = detail.status !== 'draft';
  const [employeeId, setEmployeeId] = useState<number | null>(detail.employee?.id ?? null);
  const [credits, setCredits] = useState<Record<number, string>>(
    Object.fromEntries(detail.credits.map((c) => [c.trainingId, c.creditedHours?.toString() ?? ''])),
  );
  const [completedOn, setCompletedOn] = useState(detail.completedOn ?? '');
  const [hours, setHours] = useState(detail.hours?.toString() ?? '');
  const [year, setYear] = useState(String(detail.year ?? detail.batchYear));
  const [courseTitle, setCourseTitle] = useState(detail.courseTitle ?? '');
  const [provider, setProvider] = useState(detail.provider ?? '');
  const [certNo, setCertNo] = useState(detail.certNo ?? '');
  const [choosingTraining, setChoosingTraining] = useState(false);
  const [trainingQuery, setTrainingQuery] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);

  const targetYear = Number(year) || detail.batchYear;
  const options = trainings.filter(
    (t) => (t.active && (t.fromYear ?? 0) <= targetYear && targetYear <= (t.toYear ?? 9999)) || credits[t.id] !== undefined,
  );

  function toggle(trainingId: number, checked: boolean) {
    const ids = Object.keys(credits).map(Number).filter((id) => id !== trainingId);
    if (checked) ids.push(trainingId);
    const each = split(hours, ids.length);
    setCredits(Object.fromEntries(ids.map((id) => [id, each])));
  }

  function changeHours(value: string) {
    setHours(value);
    const ids = Object.keys(credits).map(Number);
    const each = split(value, ids.length);
    setCredits(Object.fromEntries(ids.map((id) => [id, each])));
  }

  function applySuggestions(values:AssistSuggestion[]){
    const total=values.find(v=>v.field==='hours');const newHours=total&&typeof total.value==='number'?String(total.value):hours;
    const targets=values.find(v=>v.field==='trainingCodes');
    if(targets&&Array.isArray(targets.value)){const ids=targets.value.map(code=>trainings.find(t=>t.code===code)?.id).filter((id):id is number=>id!==undefined);setCredits(Object.fromEntries(ids.map(id=>[id,split(newHours,ids.length)])));}
    else if(total)changeHours(newHours);
    for(const value of values){if(value.field==='courseTitle'&&typeof value.value==='string')setCourseTitle(value.value);if(value.field==='provider'&&typeof value.value==='string')setProvider(value.value);if(value.field==='certNo'&&typeof value.value==='string')setCertNo(value.value);if(value.field==='completedOn'&&typeof value.value==='string')setCompletedOn(value.value);if(value.field==='hours'&&typeof value.value==='number')setHours(String(value.value));}
  }

  function input(): CertificateInput {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    return {
      employeeId,
      credits: Object.entries(credits).map(([id, value]) => ({ trainingId: Number(id), creditedHours: num(value) })),
      completedOn: completedOn.trim() || null,
      hours: num(hours),
      courseTitle: courseTitle.trim() || null,
      provider: provider.trim() || null,
      certNo: certNo.trim() || null,
      year: num(year),
    };
  }

  const currentInput = input();
  const inputKey = certificateInputKey(currentInput);
  const dirty = !readOnly && inputKey !== certificateInputKey(savedInput ?? initialInput.current);

  function discard() {
    const saved = certificateInputOf(detail);
    setEmployeeId(saved.employeeId);
    setCredits(Object.fromEntries(saved.credits.map(c => [c.trainingId, c.creditedHours?.toString() ?? ''])));
    setCompletedOn(saved.completedOn ?? ''); setHours(saved.hours?.toString() ?? '');
    setYear(String(saved.year ?? detail.batchYear)); setCourseTitle(saved.courseTitle ?? '');
    setProvider(saved.provider ?? ''); setCertNo(saved.certNo ?? '');
    actions.discard(saved);
  }

  useEffect(() => {
    // 성공한 깨끗한 입력은 보호를 해제한다. 실패 오류가 남으면 대기 중인 외부 이동을 자동 재개하지 않는다.
    editGuard.setPendingEdits(!busy && !dirty && !error ? null : { dirty, busy, save: () => actions.save(currentInput), discard });
  }, [editGuard, dirty, busy, error, inputKey, actions.save]);
  // 저장 결과로 현재 행이 교체되는 동안에는 페이지의 요청 보호가 계속 유지되어야 한다.
  useEffect(() => () => { if (!busyRef.current) editGuard.clearPendingEdits(); }, [editGuard]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!readOnly && !busy) void actions.confirm(input());
  }

  const read = [detail.personName && `이름 ${detail.personName}`, detail.personBirth && `생년월일 ${detail.personBirth}`, detail.personDept && `소속 ${detail.personDept}`]
    .filter(Boolean)
    .join(' · ');

  const selected = Object.entries(credits).map(([id, value]) => ({
    id: Number(id), value, name: trainings.find(t => t.id === Number(id))?.name ?? `삭제된 교육 #${id}`,
  }));
  const word = trainingQuery.replace(/\s/g, '').toLowerCase();
  const filteredOptions = options.filter(t => [t.name, ...t.keywords].some(value => value.replace(/\s/g, '').toLowerCase().includes(word)));
  const problems = detail.flags.filter(flag => flag.level !== 'info' && flag.message !== error);
  const information = detail.flags.filter(flag => flag.level === 'info');
  const firstProblem = problems.find(flag => flag.level === 'error') ?? problems[0];

  return (
    <>
    <form id="certificate-form" onSubmit={submit} className="flex h-full min-h-0 flex-col rounded-xl border border-line bg-sheet">
      <div className="shrink-0 space-y-3 border-b border-line px-4 pt-4 pb-3">
        <div>
          <p className="text-[12px] font-medium text-ink-faint">과정명</p>
          <p className="mt-0.5 line-clamp-2 text-[16px] leading-snug font-semibold" title={courseTitle}>{courseTitle || '과정명을 확인해 주세요'}</p>
        </div>
        <section aria-label="선택한 인정 교육">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-semibold">인정할 교육 <span className="text-seal">*</span></h2>
            {!readOnly && <Button size="sm" variant="ghost" disabled={busy} aria-expanded={choosingTraining} aria-haspopup="dialog" onClick={() => setChoosingTraining(v => !v)}>{selected.length ? '교육 변경' : '교육 선택'}</Button>}
          </div>
          {selected.length ? <ul className="max-h-36 space-y-1 overflow-y-auto" aria-label="현재 인정 교육">
            {selected.map(t => <li key={t.id} className="flex items-center gap-2 rounded-lg border border-navy/20 bg-navy-soft px-3 py-2">
              <span className="min-w-0 flex-1 text-[13.5px] leading-snug font-semibold text-navy">{t.name}</span>
              <label className="flex shrink-0 items-center gap-1 text-[12px] text-ink-soft">

                <input aria-label={`${t.name} 인정 시간`} type="number" min={0} max={1000} step="any" value={t.value} disabled={readOnly || busy}
                  onChange={e => setCredits({ ...credits, [t.id]: e.target.value })}
                  className="h-8 w-16 rounded border border-line-strong bg-sheet px-2 text-right text-[13px] tabular-nums disabled:bg-paper" />
                시간
              </label>
            </li>)}
          </ul> : <p className="rounded-lg border border-seal/30 bg-seal-soft px-3 py-2 text-[13px] text-seal">인정할 교육을 골라 주세요.</p>}
        </section>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-label="교육 선택과 상세 수정">
        <div>
          <p className="mb-1 text-[12px] font-medium text-ink-soft">직원</p>
          <EmployeePicker value={employeeId} employees={employees} candidates={detail.candidates} disabled={readOnly || busy} onChange={setEmployeeId} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="이수일" htmlFor="f-date" required>
            <Input id="f-date" value={completedOn} onChange={e => setCompletedOn(e.target.value)} placeholder="2026-03-31" disabled={readOnly || busy} />
          </Field>
          <Field label="교육시간" htmlFor="f-hours">
            <Input id="f-hours" type="number" min={0} max={1000} step="any" value={hours} onChange={e => changeHours(e.target.value)} disabled={readOnly || busy} />
          </Field>
        </div>

        {readOnly && <div className="rounded-lg border border-line bg-paper p-3 text-[13px]">
          {detail.status === 'confirmed' ? <div className="flex items-center gap-3"><ConfirmStamp className="size-9 text-[11px]" /><p>확정했습니다.<span className="block text-ink-soft">{detail.confirmedBy} · {formatDateTime(detail.confirmedAt)}</span></p></div>
            : <p>제외 완료 · 현황에 합산하지 않습니다.<span className="block text-ink-soft">사유: {detail.excludeReason}</span></p>}
        </div>}
        {problems.length > 0 && <div aria-label="검수 확인 사항"><FlagList flags={problems} /></div>}
        {information.length > 0 && <details className="rounded-lg border border-line bg-paper p-2.5 text-[12.5px]"><summary className="cursor-pointer text-ink-soft">판독 안내 {information.length}개</summary><div className="mt-2"><FlagList flags={information} /></div></details>}
        {!readOnly && <ReviewAssist recognitionRuleVersion={detail.recognitionRuleVersion} id={detail.id} input={currentInput} disabled={busy} trainings={trainings} onApply={applySuggestions}/>}
        <Button size="sm" variant="ghost" aria-haspopup="dialog" onClick={() => setEditingDetails(true)}>{readOnly ? '상세값 보기' : '상세값 수정'}</Button>
      </div>

      <div className="shrink-0 space-y-2 border-t border-line bg-paper/50 px-4 py-3">
        {error ? <div className="max-h-24 overflow-y-auto"><FormError message={error} /></div>
          : !readOnly && firstProblem && <p className={cn('max-h-20 overflow-y-auto text-[12.5px] leading-snug', firstProblem.level === 'error' ? 'text-seal' : 'text-warn')}>{firstProblem.level === 'error' ? '확정 전 수정 필요: ' : '원본 확인 필요: '}{firstProblem.message}</p>}
        {readOnly ? <Button onClick={() => void actions.reopen()} loading={busy} className="w-full">검수 대기로 되돌리기</Button> : <>
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Button id="certificate-exclude" variant="danger" onClick={() => actions.exclude(input(), dirty)} disabled={busy} title="단축키 X">제외</Button>
            <Button type="submit" variant="primary" loading={busy} title="단축키 Ctrl+Enter">{hasNext ? '확정하고 다음' : '확정'}</Button>
          </div>
          <div className="flex items-center gap-2">
            <p role="status" className={cn('mr-auto text-[11.5px] leading-tight', error ? 'text-seal' : dirty ? 'text-warn' : 'text-ink-faint')}>{error ? '처리하지 못했습니다.' : dirty ? '수정값 저장 전' : savedInput ? '임시 저장됨' : '원본 대조 후 확정하세요'}</p>
            <Button size="sm" variant="ghost" onClick={() => void actions.save(input())} disabled={busy}>임시 저장</Button>
            <Button size="sm" variant="ghost" disabled={busy || !hasNext} onClick={() => void actions.save(input(), true)}>저장하고 다음</Button>
          </div>
        </>}
      </div>
    </form>
    <Dialog open={choosingTraining && !readOnly} onClose={() => setChoosingTraining(false)} title="인정할 교육 선택" description="교육을 선택한 뒤 원본과 대조해 확정하세요. 닫아도 선택값은 편집 중인 화면에 유지됩니다." width="lg">
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-semibold">교육 선택 · 여러 개 선택 가능</legend>
          <Input aria-label="인정 교육 검색" value={trainingQuery} onChange={e => setTrainingQuery(e.target.value)} placeholder="교육명이나 검색어로 찾기" disabled={busy} />
          <p className="text-[12px] text-ink-faint">통합과정은 여러 개를 고릅니다. 교육시간을 나눠 인정합니다.</p>
          <ul className="grid max-h-[50dvh] grid-cols-2 gap-1.5 overflow-y-auto">
            {filteredOptions.map(t => <li key={t.id}>
              <label className={cn('flex h-full cursor-pointer items-start gap-2 rounded-lg border px-2 py-2 text-[12.5px]', credits[t.id] !== undefined ? 'border-navy/40 bg-navy-soft' : 'border-line bg-paper/50')}>
                <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-navy" checked={credits[t.id] !== undefined} disabled={busy}
                  onChange={e => toggle(t.id, e.target.checked)} aria-label={`${t.name} ${requirementText(t.reqType, t.reqValue)}`} />
                <span><span className="block leading-snug">{t.name}</span><span className="mt-1 block text-[11.5px] text-ink-faint">{requirementText(t.reqType, t.reqValue)}</span></span>
              </label>
            </li>)}
          </ul>
          {!filteredOptions.length && <p className="py-2 text-[13px] text-ink-soft">검색한 교육이 없습니다.</p>}
        </fieldset>
      <DialogActions><Button variant="primary" onClick={() => setChoosingTraining(false)}>선택 완료 ({selected.length}개)</Button></DialogActions>
    </Dialog>
    <Dialog open={editingDetails} onClose={() => setEditingDetails(false)} title={readOnly ? '상세값 보기' : '상세값 수정'} description="수정값은 편집 중인 검수 화면에 유지됩니다. 원본과 대조한 뒤 임시 저장하거나 확정하세요.">
          <div className="mt-3 space-y-3">
            <p className="text-[12px] text-ink-faint">이수증에서 읽은 값: {read || '직원 정보를 읽지 못했습니다.'}{detail.hoursText ? ` · 적힌 시간 ${detail.hoursText}` : ''}</p>
            <Field label="과정명" htmlFor="f-course"><Input id="f-course" value={courseTitle} maxLength={300} onChange={e => setCourseTitle(e.target.value)} disabled={readOnly || busy} /></Field>
            <Field label="교육기관" htmlFor="f-provider"><Input id="f-provider" value={provider} maxLength={100} onChange={e => setProvider(e.target.value)} disabled={readOnly || busy} /></Field>
            <Field label="증서번호" htmlFor="f-certno"><Input id="f-certno" value={certNo} maxLength={100} onChange={e => setCertNo(e.target.value)} disabled={readOnly || busy} /></Field>
            <Field label="인정 연도" htmlFor="f-year"><Input id="f-year" type="number" value={year} onChange={e => setYear(e.target.value)} disabled={readOnly || busy} /></Field>
          </div>      <DialogActions><Button variant="primary" onClick={() => setEditingDetails(false)}>검수 화면으로</Button></DialogActions>
    </Dialog>
    </>
  );
}
