import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileSpreadsheet, FileUp, Pencil, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { toast } from 'sonner';
import {
  FORM_MARK_STYLES,
  FORM_MARKS,
  FORM_PERSON_FIELDS,
  FORM_PERSON_LABELS,
  FORM_TRAINING_FORMAT_LABELS,
  FORM_TRAINING_FORMATS,
  type Department,
  type FormAnalysis,
  type FormColumn,
  type FormColumnFill,
  type FormLayout,
  type FormMarkStyle,
  type FormPersonField,
  type FormPreview,
  type FormTemplate,
  type FormTrainingFormat,
  type Training,
} from '@shared/types.ts';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { Button, buttonClass } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { Field, FormError, Input, Select } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { withBase } from '@/lib/base';
import { cn, formatDateTime } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';
import type { EditGuard } from '@/lib/unsavedChanges';

// 제출 양식: 기관·부서가 정한 엑셀 양식을 올려 자리와 열을 맞춰 두면, 내보내기에서 그 양식에 채워 받는다.

const MARK_STYLE_LABELS: Record<FormMarkStyle, string> = Object.fromEntries(
  FORM_MARK_STYLES.map((s) => [s, `${FORM_MARKS[s].done} / ${FORM_MARKS[s].notDone}`]),
) as Record<FormMarkStyle, string>;

function encodeFill(fill: FormColumnFill): string {
  if (fill.kind === 'person') return `person:${fill.field}`;
  if (fill.kind === 'training') return `training:${fill.trainingId}`;
  return fill.kind;
}

function decodeFill(value: string, previous: FormColumnFill): FormColumnFill {
  const [kind, arg] = value.split(':');
  if (kind === 'person') return { kind: 'person', field: arg as FormPersonField };
  if (kind === 'training') return { kind: 'training', trainingId: Number(arg), format: previous.kind === 'training' ? previous.format : 'mark' };
  return kind === 'missing' ? { kind: 'missing' } : { kind: 'none' };
}

/** 다시 찾은 열에, 사용자가 이미 고친 설정(같은 열·같은 머리글)은 그대로 둔다 */
function mergeColumns(next: FormColumn[], previous: FormColumn[]): FormColumn[] {
  return next.map((c) => previous.find((p) => p.col === c.col && p.label === c.label) ?? c);
}

/** 양식 앞부분을 작은 표로: 머리글·사람 쓸 줄·합계/서명란을 색으로 나눠 보여 준다 */
function SheetPreview({ analysis, layout }: { analysis: FormAnalysis; layout: FormLayout }) {
  const prepared = layout.footerRow - layout.dataFirst;
  const hidden = prepared > 6 ? { from: layout.dataFirst + 3, to: layout.footerRow - 2 } : null;
  const rows = analysis.rows.filter((r) => !hidden || r.row < hidden.from || r.row > hidden.to);
  const kind = (row: number) =>
    row >= layout.headerFirst && row <= layout.headerLast ? 'header' : row >= layout.dataFirst && row < layout.footerRow ? 'data' : row >= layout.footerRow ? 'footer' : 'top';
  const tone = { header: 'bg-navy-soft font-semibold text-navy', data: 'bg-ok-soft/50', footer: 'bg-warn-soft/60', top: '' } as const;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-[12.5px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.row} className={tone[kind(r.row)]}>
              <th className="w-10 border-r border-b border-line bg-head px-2 py-1 text-right font-medium text-ink-faint tabular-nums">{r.row}</th>
              {r.cells.map((text, i) => (
                <td key={i} className="max-w-[160px] truncate border-b border-l border-line/70 px-2 py-1" title={text}>
                  {text}
                </td>
              ))}
            </tr>
          ))}
          {hidden && (
            <tr className="bg-ok-soft/50">
              <td colSpan={(analysis.rows[0]?.cells.length ?? 0) + 1} className="px-3 py-1 text-center text-[12px] text-ink-faint">
                {hidden.from}~{hidden.to}행 생략 (사람을 쓸 빈 줄)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-[13.5px]">
      <span className="mb-1.5 block font-semibold">{label}</span>
      <Input type="number" min={1} className="w-24" value={value} onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))} />
    </label>
  );
}

function FormEditor({ initial, form, onClose }: { initial: FormAnalysis; form: FormTemplate | null; onClose: () => void }) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const editGuard = useOutletContext<EditGuard>();
  const [analysis, setAnalysis] = useState(initial);
  const [layout, setLayout] = useState<FormLayout>(form?.layout ?? initial.layout);
  // 저장한 양식을 고칠 때는 저장해 둔 열 설정을 쓴다 (머리글 이름은 다시 읽은 것으로)
  const [columns, setColumns] = useState<FormColumn[]>(() =>
    initial.columns.map((c) => {
      const saved = form?.columns.find((s) => s.col === c.col);
      return saved ? { ...c, fill: saved.fill } : c;
    }),
  );
  const [markStyle, setMarkStyle] = useState<FormMarkStyle>(form?.markStyle ?? 'ox');
  const [name, setName] = useState(form?.name ?? initial.fileName.replace(/\.xlsx$/i, ''));
  const [departmentId, setDepartmentId] = useState<number | null>(form ? form.departmentId : me.role === 'admin' ? null : (me.departments[0]?.id ?? null));
  const [busy, setBusy] = useState<'detect' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAttempt, setErrorAttempt] = useState(0);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const busyRef = useRef(false);
  const savedFormRef = useRef(form);
  const values = { name: name.normalize('NFC').replace(/\s+/g, ' ').trim(), departmentId, layout, columns, markStyle };
  const valuesKey = JSON.stringify(values);
  const savedKey = useRef<string | null>(form ? valuesKey : null);
  const dirty = savedKey.current === null || savedKey.current !== valuesKey;

  const trainings = useQuery({ queryKey: ['trainings'], queryFn: () => api.get<Training[]>('/trainings') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const year = new Date().getFullYear();
  const preview = useQuery({
    queryKey: ['form-preview', year, departmentId, markStyle, JSON.stringify(columns)],
    queryFn: () => api.post<FormPreview>('/forms/preview', { year, departmentId, columns, markStyle }),
    placeholderData: keepPreviousData,
  });

  async function detect(overrides: Partial<FormLayout>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('detect');
    setError(null);
    setErrorAttempt(n => n + 1);
    try {
      const next = await api.post<FormAnalysis>('/forms/reanalyze', {
        ...(savedFormRef.current ? { formId: savedFormRef.current.id } : { uploadId: analysis.uploadId }),
        ...overrides,
      });
      setAnalysis(next);
      setLayout(next.layout);
      setColumns((prev) => mergeColumns(next.columns, prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function save(close = true): Promise<boolean> {
    if (busyRef.current) return false;
    setErrorAttempt(n => n + 1);
    if (!name.trim()) { setError('양식 이름을 적어 주세요.'); return false; }
    busyRef.current = true;
    setBusy('save');
    setError(null);
    try {
      const saved = savedFormRef.current
        ? await api.put<FormTemplate>(`/forms/${savedFormRef.current.id}`, values)
        : await api.post<FormTemplate>('/forms', { ...values, uploadId: analysis.uploadId });
      savedFormRef.current = saved;
      savedKey.current = valuesKey;
      await queryClient.invalidateQueries({ queryKey: ['forms'] });
      toast.success(`'${name}' 양식을 저장했습니다. 내보내기에서 이 양식에 채워 받을 수 있습니다.`);
      if (close) { editGuard.clearPendingEdits(); onClose(); }
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function discard() {
    const saved = savedFormRef.current;
    if (!saved) { editGuard.clearPendingEdits(); onClose(); return; }
    savedKey.current = JSON.stringify({ name: saved.name, departmentId: saved.departmentId, layout: saved.layout, columns: saved.columns, markStyle: saved.markStyle });
    setName(saved.name); setDepartmentId(saved.departmentId); setLayout(saved.layout);
    setColumns(saved.columns); setMarkStyle(saved.markStyle); setError(null);
  }

  function requestClose() {
    if (busyRef.current) return;
    if (dirty) setCloseConfirm(true);
    else { editGuard.clearPendingEdits(); onClose(); }
  }

  useEffect(() => {
    editGuard.setPendingEdits({ dirty, busy: busy !== null, save: () => save(false), discard,
      saveDescription: '양식 이름과 열 설정을 저장한 뒤 이동할 수 있습니다. 버리고 이동하면 이번에 고친 값은 저장되지 않습니다.' });
  }, [editGuard, dirty, busy, valuesKey]);
  useEffect(() => () => editGuard.clearPendingEdits(), [editGuard]);

  const setFill = (col: number, fill: FormColumnFill) => setColumns((cs) => cs.map((c) => (c.col === col ? { ...c, fill } : c)));
  const prepared = layout.footerRow - layout.dataFirst;
  const filled = columns.filter((c) => c.fill.kind !== 'none').length;
  const usable = (trainings.data ?? []).filter((t) => t.active || columns.some((c) => c.fill.kind === 'training' && c.fill.trainingId === t.id));
  const editableDepartments = (departments.data ?? []).filter((d) => me.role === 'admin' || me.departments.some((m) => m.id === d.id));

  return (
    <>
      <PageHeader
        title={form ? `${form.name} — 열 맞추기` : '새 제출 양식'}
        description="양식에서 찾은 자리와 열마다 넣을 내용입니다. 틀린 곳만 고치고 저장하세요."
        actions={
          <Button onClick={requestClose} disabled={busy !== null}>
            <ArrowLeft className="size-4" aria-hidden />
            목록으로
          </Button>
        }
      />
      <fieldset disabled={busy !== null} aria-busy={busy !== null} className="min-w-0 space-y-6 border-0 p-0">
        <FormError message={error} attentionKey={errorAttempt} />
        {analysis.warnings.length > 0 && (
          <ul className="space-y-2">
            {analysis.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-[14px]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}

        <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-bold">1. 양식에서 찾은 자리</h2>
            <span className="text-[13.5px] text-ink-faint">{analysis.fileName}</span>
          </div>
          <p className="mt-1 text-[14px] text-ink-soft">
            {prepared > 0
              ? `빈 줄 ${prepared}개(${layout.dataFirst}~${layout.footerRow - 1}행)에 한 사람씩 씁니다. 사람이 더 많으면 줄을 끼워 넣고, 아래 합계·서명란은 그만큼 내려갑니다.`
              : `빈 줄이 없어 ${layout.dataFirst}행부터 머리글 모양을 본뜬 줄을 만들어 씁니다.`}
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            {analysis.sheets.length > 1 && (
              <label className="block text-[13.5px]">
                <span className="mb-1.5 block font-semibold">시트</span>
                <Select className="w-44" value={layout.sheetName} onChange={(e) => void detect({ sheetName: e.target.value })}>
                  {analysis.sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </label>
            )}
            <NumberField label="머리글 시작 줄" value={layout.headerFirst} onChange={(v) => setLayout({ ...layout, headerFirst: v })} />
            <NumberField label="머리글 끝 줄" value={layout.headerLast} onChange={(v) => setLayout({ ...layout, headerLast: v })} />
            <NumberField label="첫 사람 줄" value={layout.dataFirst} onChange={(v) => setLayout({ ...layout, dataFirst: v })} />
            <NumberField label="합계·서명란 줄" value={layout.footerRow} onChange={(v) => setLayout({ ...layout, footerRow: v })} />
            <Button onClick={() => void detect(layout)} loading={busy === 'detect'}>
              <RefreshCw className="size-4" aria-hidden />이 줄 번호로 다시 읽기
            </Button>
          </div>
          <div className="mt-4">
            <SheetPreview analysis={analysis} layout={layout} />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-4 text-[12.5px] text-ink-faint">
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-navy-soft align-middle ring-1 ring-navy/30" />
              머리글
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-ok-soft align-middle ring-1 ring-ok/30" />
              사람을 쓸 줄
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm bg-warn-soft align-middle ring-1 ring-warn/30" />
              합계·서명란 (아래로 밀림)
            </span>
          </p>
        </section>

        <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
          <h2 className="text-[17px] font-bold">2. 열마다 넣을 내용</h2>
          <p className="mt-1 text-[14px] text-ink-soft">
            {filled}개 열을 채웁니다. &lsquo;비워 둠&rsquo; 열은 양식 그대로 둡니다.
            {analysis.placeholders.length > 0 && ` 양식의 ${analysis.placeholders.map((p) => `{${p}}`).join(', ')} 자리도 채웁니다.`}
          </p>
          <Table className="mt-4">
            <thead>
              <tr>
                <Th className="w-14">열</Th>
                <Th>양식 머리글</Th>
                <Th className="w-[300px]">넣을 내용</Th>
                <Th className="w-[260px]">형식</Th>
              </tr>
            </thead>
            <tbody>
              {columns.map((c) => (
                <Tr key={c.col}>
                  <Td className="font-semibold text-ink-faint">{c.letter}</Td>
                  <Td className="font-medium">{c.label || <span className="text-ink-faint">(머리글 없음)</span>}</Td>
                  <Td>
                    <Select
                      value={encodeFill(c.fill)}
                      onChange={(e) => setFill(c.col, decodeFill(e.target.value, c.fill))}
                      aria-label={`${c.letter}열에 넣을 내용`}
                      className={cn(c.fill.kind === 'none' && 'text-ink-faint')}
                    >
                      <option value="none">비워 둠</option>
                      <optgroup label="사람">
                        {FORM_PERSON_FIELDS.map((f) => (
                          <option key={f} value={`person:${f}`}>
                            {FORM_PERSON_LABELS[f]}
                          </option>
                        ))}
                        <option value="missing">아직 이수하지 않은 교육 (비고용)</option>
                      </optgroup>
                      <optgroup label="교육">
                        {usable.map((t) => (
                          <option key={t.id} value={`training:${t.id}`}>
                            {t.name}
                          </option>
                        ))}
                      </optgroup>
                    </Select>
                  </Td>
                  <Td>
                    {c.fill.kind === 'training' && (
                      <Select
                        value={c.fill.format}
                        onChange={(e) => setFill(c.col, { ...(c.fill as FormColumnFill & { kind: 'training' }), format: e.target.value as FormTrainingFormat })}
                        aria-label={`${c.letter}열 형식`}
                      >
                        {FORM_TRAINING_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {FORM_TRAINING_FORMAT_LABELS[f]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[14px]">
            <span className="font-semibold">이수 표시 모양</span>
            <div className="flex rounded-lg bg-ink/[0.05] p-0.5" role="radiogroup" aria-label="이수 표시 모양">
              {FORM_MARK_STYLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={markStyle === s}
                  onClick={() => setMarkStyle(s)}
                  className={cn(
                    'rounded-md px-3 py-1 text-[13.5px] font-semibold transition-colors',
                    markStyle === s ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_27_38/0.12)]' : 'text-ink-soft hover:text-ink',
                  )}
                >
                  {MARK_STYLE_LABELS[s]}
                </button>
              ))}
            </div>
            <span className="text-[13px] text-ink-faint">부분이수는 미이수로, 대상 제외는 &ldquo;-&rdquo;로 씁니다.</span>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
          <h2 className="text-[17px] font-bold">3. 미리보기</h2>
          <p className="mt-1 text-[14px] text-ink-soft">
            {year}년 확정한 이수증으로 앞의 몇 명을 채워 본 모습입니다{preview.data ? ` (실제로는 ${preview.data.total}명을 씁니다)` : ''}.
          </p>
          {preview.data && preview.data.rows.length > 0 ? (
            <Table className="mt-4">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <Th key={c.col} className={cn(c.fill.kind === 'none' && 'text-ink-faint/60')}>
                      {c.label || c.letter}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.data.rows.map((row, i) => (
                  <Tr key={i}>
                    {row.map((v, j) => (
                      <Td key={j} className="whitespace-nowrap">
                        {v}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="mt-4 text-[14px] text-ink-faint">{preview.isLoading ? '채워 보는 중…' : '채울 직원이 없습니다. 직원 명단을 먼저 등록해 주세요.'}</p>
          )}
        </section>

        <section className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-sheet p-6 shadow-surface">
          <Field label="양식 이름" htmlFor="form-name" required className="w-72">
            <Input id="form-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </Field>
          <Field label="쓰는 부서" htmlFor="form-department" className="w-56">
            <Select id="form-department" value={departmentId ?? ''} onChange={(e) => setDepartmentId(e.target.value ? Number(e.target.value) : null)}>
              {me.role === 'admin' && <option value="">모든 부서 공용</option>}
              {editableDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="ml-auto flex gap-2">
            <Button onClick={requestClose}>취소</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy === 'save'} disabled={!name.trim()}>
              양식 저장
            </Button>
          </div>
        </section>
      </fieldset>
      <p role="status" className="mt-3 text-[13px] text-ink-soft">{busy === 'save' ? '양식을 저장하는 중입니다.' : busy === 'detect' ? '양식을 다시 읽는 중입니다.' : dirty ? '아직 저장하지 않은 양식 설정이 있습니다.' : '변경사항이 없습니다.'}</p>
      <Dialog open={closeConfirm} title="양식 설정을 저장할까요?" dismissible={busy === null} onClose={() => { if (!busyRef.current) setCloseConfirm(false); }}>
        <p className="text-[14px] text-ink-soft">양식 이름과 열 설정을 저장한 뒤 목록으로 돌아갈 수 있습니다.</p>
        <DialogActions>
          <Button disabled={busy !== null} onClick={() => setCloseConfirm(false)} data-autofocus>계속 수정</Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => { editGuard.clearPendingEdits(); onClose(); }}>버리고 닫기</Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => { setCloseConfirm(false); void save(); }}>저장 후 닫기</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function FormsPage() {
  const queryClient = useQueryClient();
  const forms = useQuery({ queryKey: ['forms'], queryFn: () => api.get<FormTemplate[]>('/forms') });
  const [editing, setEditing] = useState<{ analysis: FormAnalysis; form: FormTemplate | null } | null>(null);
  const [action, setAction] = useState<{ kind: 'upload' } | { kind: 'edit' | 'delete'; id: number } | null>(null);
  const busy = action !== null;
  const busyRef = useRef(false);
  const requestGeneration = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<FormTemplate | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [editing]);
  useEffect(() => () => { requestGeneration.current++; }, []);

  function begin(next: NonNullable<typeof action>): number | null {
    // disabled 속성이 반영되기 전의 연속 클릭·드롭도 요청 하나로 제한한다.
    if (busyRef.current) return null;
    busyRef.current = true;
    setAction(next);
    setError(null);
    return ++requestGeneration.current;
  }

  function finish(generation: number) {
    if (generation !== requestGeneration.current) return;
    busyRef.current = false;
    setAction(null);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    const generation = begin({ kind: 'upload' });
    if (generation === null) return;
    try {
      const body = new FormData();
      body.append('file', file);
      const analysis = await api.post<FormAnalysis>('/forms/analyze', body);
      if (generation === requestGeneration.current) setEditing({ analysis, form: null });
    } catch (err) {
      if (generation === requestGeneration.current) setError(errorMessage(err));
    } finally {
      finish(generation);
    }
  }

  async function edit(form: FormTemplate) {
    const generation = begin({ kind: 'edit', id: form.id });
    if (generation === null) return;
    try {
      const analysis = await api.post<FormAnalysis>('/forms/reanalyze', { formId: form.id, ...form.layout });
      if (generation === requestGeneration.current) setEditing({ analysis, form });
    } catch (err) {
      if (generation === requestGeneration.current) toast.error(errorMessage(err));
    } finally {
      finish(generation);
    }
  }

  async function remove(form: FormTemplate) {
    const generation = begin({ kind: 'delete', id: form.id });
    if (generation === null) return;
    try {
      await api.delete(`/forms/${form.id}`);
      await queryClient.invalidateQueries({ queryKey: ['forms'] });
      if (generation === requestGeneration.current) toast.success(`'${form.name}' 양식을 지웠습니다.`);
    } catch (err) {
      if (generation === requestGeneration.current) toast.error(errorMessage(err));
    } finally {
      if (generation === requestGeneration.current) setDeleting(null);
      finish(generation);
    }
  }

  if (editing) return <FormEditor key={editing.form ? `form-${editing.form.id}` : `upload-${editing.analysis.uploadId}`} initial={editing.analysis} form={editing.form} onClose={() => setEditing(null)} />;

  return (
    <>
      <PageHeader
        title="제출 양식"
        description="기관·부서가 정한 엑셀 양식을 올려 두면, 내보내기에서 이수 현황을 그 양식 그대로 채워 받을 수 있습니다."
        actions={
          <Link to="/export" className={buttonClass('secondary')}>
            <ArrowLeft className="size-4" aria-hidden />
            내보내기로
          </Link>
        }
      />

      <label
        htmlFor="form-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(e.dataTransfer.files[0]);
        }}
        className={cn(
          'group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed bg-sheet px-6 py-10 text-center transition-colors',
          dragging ? 'border-navy bg-navy-soft/60' : 'border-line-strong hover:border-navy/50 hover:bg-navy-soft/40',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-navy-soft text-navy transition-transform duration-200 group-hover:-translate-y-0.5">
          <FileUp className="size-6" aria-hidden />
        </span>
        <span className="text-[16px] font-bold">{action?.kind === 'delete' ? '양식을 지우는 중…' : busy ? '양식을 읽는 중…' : '빈 제출 양식(.xlsx)을 끌어다 놓거나 눌러서 고르세요'}</span>
        <span className="text-[13.5px] text-ink-faint">
          한 사람이 한 줄인 명단형 양식을 읽습니다. 옛 엑셀(.xls)은 엑셀에서 &lsquo;다른 이름으로 저장 → .xlsx&rsquo;로 바꿔 올려 주세요.
        </span>
        <input
          id="form-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      <div className="mt-4">
        <FormError message={error} />
      </div>

      <section className="mt-8">
        <h2 className="text-[19px] font-bold">올려 둔 양식</h2>
        {forms.isPending ? (
          <LoadingRows rows={2} />
        ) : (forms.data ?? []).length === 0 ? (
          <div className="mt-4">
            <EmptyState title="아직 올린 양식이 없습니다" description="제출할 때 쓰는 빈 엑셀 양식을 위에 올리면, 머리글과 빈 줄을 찾아 열마다 넣을 내용을 맞춰 줍니다." />
          </div>
        ) : (
          <Table className="mt-4">
            <thead>
              <tr>
                <Th>양식 이름</Th>
                <Th>쓰는 부서</Th>
                <Th>채우는 열</Th>
                <Th>고친 때</Th>
                <Th className="w-[1%]" />
              </tr>
            </thead>
            <tbody>
              {forms.data!.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <span className="flex items-center gap-2 font-semibold">
                      <FileSpreadsheet className="size-4 text-ok" aria-hidden />
                      {f.name}
                    </span>
                    <span className="block text-[12.5px] text-ink-faint">{f.fileName}</span>
                  </Td>
                  <Td>{f.departmentName ? f.departmentName : <Tag tone="navy">모든 부서 공용</Tag>}</Td>
                  <Td className="tabular-nums">{f.columns.filter((c) => c.fill.kind !== 'none').length}개</Td>
                  <Td className="whitespace-nowrap text-ink-soft">{formatDateTime(f.updatedAt)}</Td>
                  <Td>
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <a href={withBase(`/api/forms/${f.id}/file`)} className={buttonClass('ghost', 'sm')} title="올린 빈 양식 받기">
                        <Download className="size-4" aria-hidden />빈 양식
                      </a>
                      {f.canEdit && (
                        <>
                          <Button variant="ghost" size="sm" disabled={busy} loading={action?.kind === 'edit' && action.id === f.id} onClick={() => void edit(f)}>
                            <Pencil className="size-4" aria-hidden />열 맞추기
                          </Button>
                          <Button variant="ghost" size="sm" className="hover:bg-seal-soft hover:text-seal" disabled={busy} onClick={() => { if (!busyRef.current) setDeleting(f); }} aria-label={`${f.name} 지우기`}>
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="양식 지우기"
        description={`'${deleting?.name ?? ''}' 양식을 지웁니다. 이미 받은 파일에는 영향이 없습니다.`}
        confirmLabel="지우기"
        busy={action?.kind === 'delete'}
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => { if (!busyRef.current) setDeleting(null); }}
      />
    </>
  );
}
