import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { CertificateDetail, CertificateFlag, CertificateInput, Employee, Training } from '@shared/types.ts';
import { ConfirmStamp } from '@/components/SealMark';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { cn, formatDateTime, requirementText } from '@/lib/format';
import { EmployeePicker } from './EmployeePicker';

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
  save: (input: CertificateInput) => Promise<void>;
  confirm: (input: CertificateInput) => Promise<void>;
  exclude: () => void;
  reopen: () => Promise<void>;
}

export function CertificateForm({
  detail,
  trainings,
  employees,
  busy,
  error,
  actions,
}: {
  detail: CertificateDetail;
  trainings: Training[];
  employees: Employee[];
  busy: boolean;
  error: string | null;
  actions: FormActions;
}) {
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

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!readOnly) void actions.confirm(input());
  }

  const read = [detail.personName && `이름 ${detail.personName}`, detail.personBirth && `생년월일 ${detail.personBirth}`, detail.personDept && `소속 ${detail.personDept}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <form id="certificate-form" onSubmit={submit} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
        {readOnly && (
          <div className="flex items-center gap-3 rounded-md border border-line bg-sheet px-4 py-3">
            {detail.status === 'confirmed' ? (
              <>
                <ConfirmStamp className="size-11 text-[12px]" />
                <p className="text-[13.5px]">
                  <span className="font-medium">확정했습니다.</span>
                  <span className="block text-ink-soft">
                    {detail.confirmedBy} · {formatDateTime(detail.confirmedAt)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-[13.5px]">
                <span className="font-medium">제외했습니다.</span> <span className="text-ink-soft">사유: {detail.excludeReason}</span>
              </p>
            )}
          </div>
        )}

        <FlagList flags={detail.flags} />
        <FormError message={error} />

        <Field label="직원" required hint={read ? `이수증에서 읽은 값: ${read}` : '이수증에서 이름을 읽지 못했습니다.'}>
          <EmployeePicker value={employeeId} employees={employees} candidates={detail.candidates} disabled={readOnly} onChange={setEmployeeId} />
        </Field>

        <fieldset>
          <legend className="text-[13px] font-medium">
            인정할 교육<span className="ml-0.5 text-seal">*</span>
          </legend>
          <p className="mt-0.5 text-[12.5px] text-ink-faint">통합과정이면 여러 개를 고르세요. 교육시간을 나눠 인정합니다.</p>
          <ul className="mt-2 divide-y divide-line rounded-md border border-line bg-sheet">
            {options.map((t) => {
              const checked = credits[t.id] !== undefined;
              return (
                <li key={t.id} className="flex items-center gap-3 px-3 py-1.5">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-[13.5px]">
                    <input
                      type="checkbox"
                      className="size-4 accent-navy"
                      checked={checked}
                      disabled={readOnly}
                      onChange={(e) => toggle(t.id, e.target.checked)}
                    />
                    <span className={cn('truncate', checked && 'font-medium')}>{t.name}</span>
                    <span className="shrink-0 text-[12px] text-ink-faint">{requirementText(t.reqType, t.reqValue)}</span>
                  </label>
                  {checked && (
                    <label className="flex shrink-0 items-center gap-1 text-[12.5px] text-ink-soft">
                      인정
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={credits[t.id]}
                        disabled={readOnly}
                        onChange={(e) => setCredits({ ...credits, [t.id]: e.target.value })}
                        className="h-7 w-16 rounded border border-line-strong px-1.5 text-right text-[13px] tabular-nums disabled:bg-paper"
                        aria-label={`${t.name} 인정 시간`}
                      />
                      시간
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>

        <div className="grid grid-cols-3 gap-3">
          <Field label="이수일" htmlFor="f-date" required>
            <Input id="f-date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} placeholder="2026-03-31" disabled={readOnly} />
          </Field>
          <Field label="교육시간" htmlFor="f-hours" hint={detail.hoursText && detail.hoursText !== hours ? `적힌 값: ${detail.hoursText}` : undefined}>
            <Input id="f-hours" type="number" min={0} step={0.5} value={hours} onChange={(e) => changeHours(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="인정 연도" htmlFor="f-year">
            <Input id="f-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} disabled={readOnly} />
          </Field>
        </div>
        <Field label="과정명" htmlFor="f-course">
          <Input id="f-course" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} disabled={readOnly} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="교육기관" htmlFor="f-provider">
            <Input id="f-provider" value={provider} onChange={(e) => setProvider(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label="증서번호" htmlFor="f-certno">
            <Input id="f-certno" value={certNo} onChange={(e) => setCertNo(e.target.value)} disabled={readOnly} />
          </Field>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {readOnly ? (
          <Button onClick={() => void actions.reopen()} loading={busy}>
            검수 대기로 되돌리기
          </Button>
        ) : (
          <>
            <Button variant="danger" onClick={actions.exclude} disabled={busy} title="단축키 X">
              제외
            </Button>
            <Button onClick={() => void actions.save(input())} disabled={busy} className="ml-auto">
              저장
            </Button>
            <Button type="submit" variant="primary" loading={busy} title="단축키 Ctrl+Enter">
              확정
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
