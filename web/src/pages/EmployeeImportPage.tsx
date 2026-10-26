import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { autoMapColumns } from '@shared/rosterColumns.ts';
import {
  ROSTER_FIELDS,
  type RosterApplyResult,
  type RosterMapping,
  type RosterParseResult,
  type RosterPreview,
  type RosterPreviewRow,
} from '@shared/types.ts';
import { ApprovalSteps } from '@/components/ApprovalSteps';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmStamp } from '@/components/SealMark';
import { Button, buttonClass } from '@/components/ui/Button';
import { FormError, Select } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { Tag } from '@/components/ui/Tag';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';

const STEPS = ['파일 선택', '열 확인', '미리보기', '반영'];

/** 0 → A, 25 → Z, 26 → AA (엑셀 열 이름) */
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

export function EmployeeImportPage() {
  const queryClient = useQueryClient();
  const [parsed, setParsed] = useState<RosterParseResult | null>(null);
  const [headerRowIndex, setHeaderRowIndex] = useState(0);
  const [mapping, setMapping] = useState<RosterMapping | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [retireMissing, setRetireMissing] = useState(false);
  const [result, setResult] = useState<RosterApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = result ? STEPS.length : preview ? 2 : parsed ? 1 : 0;

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function applyParsed(next: RosterParseResult) {
    setParsed(next);
    setHeaderRowIndex(next.headerRowIndex);
    setMapping(next.mapping);
    setPreview(null);
  }

  function upload(file: File) {
    void run(async () => {
      const form = new FormData();
      form.append('file', file);
      applyParsed(await api.post<RosterParseResult>('/employees/import/parse', form));
    });
  }

  function options() {
    return { importId: parsed!.importId, sheetIndex: parsed!.sheetIndex, headerRowIndex, mapping: mapping!, retireMissing };
  }

  function reset() {
    setParsed(null);
    setMapping(null);
    setPreview(null);
    setResult(null);
    setRetireMissing(false);
    setError(null);
  }

  return (
    <>
      <PageHeader
        title="직원 명단 일괄 등록"
        description="인사 명단 엑셀을 올리면 새 직원은 등록하고, 부서·직급이 바뀐 직원은 고칩니다. 반영하기 전에 바뀌는 내용을 먼저 보여 드립니다."
        actions={
          <Link to="/employees" className="text-[13.5px] text-link hover:underline">
            직원 명단으로 돌아가기
          </Link>
        }
      />
      <ApprovalSteps steps={STEPS} current={current} />
      <div className="mt-6 space-y-4">
        <FormError message={error} />
        {current === 0 && <FileStep busy={busy} onFile={upload} />}
        {current === 1 && parsed && mapping && (
          <MappingStep
            parsed={parsed}
            headerRowIndex={headerRowIndex}
            mapping={mapping}
            busy={busy}
            onSheet={(sheetIndex) =>
              void run(async () =>
                applyParsed(
                  await api.post<RosterParseResult>('/employees/import/sheet', { importId: parsed.importId, sheetIndex }),
                ),
              )
            }
            onHeaderRow={(index) => {
              setHeaderRowIndex(index);
              setMapping(autoMapColumns(parsed.topRows[index] ?? []));
            }}
            onMapping={setMapping}
            onBack={reset}
            onNext={() =>
              void run(async () => setPreview(await api.post<RosterPreview>('/employees/import/preview', options())))
            }
          />
        )}
        {current === 2 && preview && (
          <PreviewStep
            preview={preview}
            retireMissing={retireMissing}
            onRetireMissing={setRetireMissing}
            busy={busy}
            onBack={() => setPreview(null)}
            onApply={() =>
              void run(async () => {
                setResult(await api.post<RosterApplyResult>('/employees/import/apply', options()));
                await Promise.all(
                  ['employees', 'departments', 'overview'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
                );
              })
            }
          />
        )}
        {result && <DoneStep result={result} onAgain={reset} />}
      </div>
    </>
  );
}

function FileStep({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);

  function drop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <label
        htmlFor="roster-file"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed bg-sheet px-6 py-14 text-center transition-colors',
          dragging ? 'border-navy bg-navy-soft' : 'border-line-strong hover:border-navy/60',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <FileSpreadsheet className="size-9 text-navy" aria-hidden />
        <span className="text-[15px] font-medium">
          {busy ? '파일을 읽는 중…' : '인사 명단 파일을 여기에 끌어다 놓거나 눌러서 고르세요'}
        </span>
        <span className="text-[13px] text-ink-faint">엑셀(.xlsx)과 CSV를 받습니다. 한글 윈도우에서 저장한 CSV도 됩니다.</span>
        <input
          id="roster-file"
          type="file"
          accept=".xlsx,.csv,.txt"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
            e.target.value = '';
          }}
        />
      </label>
      <div className="rounded-xl border border-line bg-sheet px-5 py-4 text-[13px] text-ink-soft">
        <p className="font-medium text-ink">알아 두면 좋은 점</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4">
          <li>위쪽에 제목 줄이나 빈 줄이 있어도 머리글 줄을 찾아냅니다.</li>
          <li>사번 열이 있으면 기존 직원과 가장 정확하게 맞춥니다. 없으면 이름과 생년월일로 맞춥니다.</li>
          <li>주민등록번호 열은 생년월일만 저장하고 나머지 번호는 버립니다.</li>
          <li>빈 칸은 기존 정보를 지우지 않습니다.</li>
        </ul>
      </div>
    </div>
  );
}

function MappingStep({
  parsed,
  headerRowIndex,
  mapping,
  busy,
  onSheet,
  onHeaderRow,
  onMapping,
  onBack,
  onNext,
}: {
  parsed: RosterParseResult;
  headerRowIndex: number;
  mapping: RosterMapping;
  busy: boolean;
  onSheet: (index: number) => void;
  onHeaderRow: (index: number) => void;
  onMapping: (mapping: RosterMapping) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const headers = parsed.topRows[headerRowIndex] ?? [];
  const samples = parsed.topRows.slice(headerRowIndex + 1, headerRowIndex + 4);
  const missingRequired = ROSTER_FIELDS.filter((f) => f.required && mapping[f.key] === null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-line bg-sheet px-6 py-5 shadow-surface">
        <div>
          <p className="text-[12.5px] text-ink-faint">파일</p>
          <p className="font-medium">{parsed.fileName}</p>
        </div>
        {parsed.sheets.length > 1 && (
          <label className="block text-[13.5px]">
            <span className="mb-1 block text-ink-soft">시트</span>
            <Select value={parsed.sheetIndex} onChange={(e) => onSheet(Number(e.target.value))} className="w-48" disabled={busy}>
              {parsed.sheets.map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name} ({formatNumber(s.rowCount)}줄)
                </option>
              ))}
            </Select>
          </label>
        )}
        <label className="block min-w-0 flex-1 text-[13.5px]">
          <span className="mb-1 block text-ink-soft">머리글 줄</span>
          <Select value={headerRowIndex} onChange={(e) => onHeaderRow(Number(e.target.value))}>
            {parsed.topRows.map((row, i) => (
              <option key={i} value={i}>
                {i + 1}행: {row.filter(Boolean).slice(0, 6).join(' | ') || '(빈 줄)'}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <Table>
        <thead>
          <tr>
            <Th className="w-36">항목</Th>
            <Th className="w-72">파일의 열</Th>
            <Th>첫 줄 값 미리보기</Th>
          </tr>
        </thead>
        <tbody>
          {ROSTER_FIELDS.map((field) => {
            const column = mapping[field.key];
            return (
              <Tr key={field.key}>
                <Td className="font-medium">
                  {field.label}
                  {field.required && <span className="ml-0.5 text-seal">*</span>}
                </Td>
                <Td>
                  <Select
                    aria-label={`${field.label} 열`}
                    value={column ?? ''}
                    onChange={(e) =>
                      onMapping({ ...mapping, [field.key]: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  >
                    <option value="">{field.required ? '열을 골라 주세요' : '쓰지 않음'}</option>
                    {headers.map((header, i) => (
                      <option key={i} value={i}>
                        {columnName(i)}열 · {header || '(머리글 없음)'}
                      </option>
                    ))}
                  </Select>
                </Td>
                <Td className="text-ink-soft">
                  {column === null ? (
                    <span className="text-ink-faint">-</span>
                  ) : (
                    samples
                      .map((row) => row[column])
                      .filter(Boolean)
                      .join(', ') || <span className="text-ink-faint">(값 없음)</span>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={onBack}>다른 파일 고르기</Button>
        <div className="flex items-center gap-3">
          {missingRequired.length > 0 && (
            <span className="text-[13px] text-seal">{missingRequired.map((f) => f.label).join('·')} 열을 골라 주세요.</span>
          )}
          <Button variant="primary" loading={busy} disabled={missingRequired.length > 0} onClick={onNext}>
            바뀌는 내용 미리보기
          </Button>
        </div>
      </div>
    </div>
  );
}

type PreviewTab = 'error' | 'changed' | 'new' | 'unchanged' | 'missing';

function PreviewStep({
  preview,
  retireMissing,
  onRetireMissing,
  busy,
  onBack,
  onApply,
}: {
  preview: RosterPreview;
  retireMissing: boolean;
  onRetireMissing: (value: boolean) => void;
  busy: boolean;
  onBack: () => void;
  onApply: () => void;
}) {
  const { counts } = preview;
  const firstTab = (['error', 'changed', 'new', 'missing', 'unchanged'] as PreviewTab[]).find((t) => counts[t] > 0) ?? 'new';
  const [tab, setTab] = useState<PreviewTab>(firstTab);
  const rows = useMemo(() => preview.rows.filter((r) => r.kind === tab), [preview.rows, tab]);
  const retireCount = retireMissing ? counts.missing : 0;
  const nothingToDo = counts.new + counts.changed + retireCount === 0;

  const tabs: { key: PreviewTab; label: string }[] = [
    { key: 'new', label: '새로 등록' },
    { key: 'changed', label: '정보 변경' },
    { key: 'unchanged', label: '그대로' },
    { key: 'error', label: '오류' },
    { key: 'missing', label: '명단에 없음' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-sheet sm:grid-cols-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className={cn(
              'border-line px-4 py-3 text-left transition-colors not-last:border-r',
              tab === t.key ? 'bg-navy-soft' : 'hover:bg-paper',
            )}
          >
            <span className="block text-[12.5px] text-ink-soft">{t.label}</span>
            <span
              className={cn(
                'mt-0.5 block text-[22px] font-semibold tabular-nums',
                t.key === 'error' && counts.error > 0 && 'text-seal',
                t.key === 'missing' && counts.missing > 0 && 'text-warn',
              )}
            >
              {formatNumber(counts[t.key])}
            </span>
          </button>
        ))}
      </div>

      {(preview.newDepartments.length > 0 || preview.notices.length > 0) && (
        <ul className="space-y-1 rounded-xl border border-line bg-sheet px-5 py-3 text-[13px] text-ink-soft">
          {preview.newDepartments.length > 0 && (
            <li>
              새로 만들 부서 {preview.newDepartments.length}개: <span className="text-ink">{preview.newDepartments.join(', ')}</span>
            </li>
          )}
          {preview.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {tab === 'missing' ? (
        <MissingTable preview={preview} />
      ) : (
        <PreviewTable rows={rows} />
      )}

      {counts.missing > 0 && (
        <label className="flex items-start gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-[13.5px]">
          <input
            type="checkbox"
            className="mt-1 size-4 accent-navy"
            checked={retireMissing}
            onChange={(e) => onRetireMissing(e.target.checked)}
          />
          <span>
            <span className="font-medium">명단에 없는 기존 직원 {formatNumber(counts.missing)}명을 퇴직 처리합니다.</span>
            <span className="mt-0.5 block text-ink-soft">
              기관 전체 명단을 올린 경우에만 고르세요. 일부 부서 명단이라면 고르지 마세요.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={onBack}>열 다시 고르기</Button>
        <div className="flex items-center gap-3">
          {counts.error > 0 && (
            <span className="text-[13px] text-ink-soft">오류 {formatNumber(counts.error)}행은 빼고 반영합니다.</span>
          )}
          <Button variant="primary" loading={busy} disabled={nothingToDo} onClick={onApply}>
            {nothingToDo
              ? '반영할 내용이 없습니다'
              : `반영하기 (등록 ${formatNumber(counts.new)} · 변경 ${formatNumber(counts.changed)}${
                  retireCount ? ` · 퇴직 ${formatNumber(retireCount)}` : ''
                })`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PreviewTable({ rows }: { rows: RosterPreviewRow[] }) {
  const shown = rows.slice(0, 300);
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th className="w-16">행</Th>
            <Th className="w-24">사번</Th>
            <Th className="w-28">성명</Th>
            <Th className="w-40">부서</Th>
            <Th>내용</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <Tr key={row.rowNumber}>
              <Td className="text-ink-faint tabular-nums">{row.rowNumber}</Td>
              <Td className="tabular-nums">{row.empNo ?? '-'}</Td>
              <Td className="font-medium">{row.name || '-'}</Td>
              <Td>{row.departmentName || '-'}</Td>
              <Td className="space-y-0.5 text-[13px]">
                {row.changes.map((c) => (
                  <p key={c.field}>
                    {c.label}: <span className="text-ink-faint">{c.before ?? '(없음)'}</span> →{' '}
                    <span className="font-medium">{c.after}</span>
                  </p>
                ))}
                {row.errors.map((m) => (
                  <p key={m} className="text-seal">
                    {m}
                  </p>
                ))}
                {row.warnings.map((m) => (
                  <p key={m} className="text-warn">
                    {m}
                  </p>
                ))}
                {row.kind === 'new' && row.errors.length + row.warnings.length === 0 && (
                  <Tag tone="ok">새 직원</Tag>
                )}
                {row.kind === 'unchanged' && row.warnings.length === 0 && <span className="text-ink-faint">바뀐 내용 없음</span>}
              </Td>
            </Tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={5} className="py-8 text-center text-ink-faint">
                해당하는 행이 없습니다.
              </Td>
            </tr>
          )}
        </tbody>
      </Table>
      {rows.length > shown.length && (
        <p className="text-[13px] text-ink-faint">앞의 300행만 보여 줍니다. 반영은 전체 {formatNumber(rows.length)}행에 적용됩니다.</p>
      )}
    </>
  );
}

function MissingTable({ preview }: { preview: RosterPreview }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-24">사번</Th>
          <Th className="w-32">성명</Th>
          <Th>부서</Th>
        </tr>
      </thead>
      <tbody>
        {preview.missing.slice(0, 300).map((m) => (
          <Tr key={m.id}>
            <Td className="tabular-nums">{m.empNo ?? '-'}</Td>
            <Td className="font-medium">{m.name}</Td>
            <Td>{m.departmentName ?? '-'}</Td>
          </Tr>
        ))}
        {preview.missing.length === 0 && (
          <tr>
            <Td colSpan={3} className="py-8 text-center text-ink-faint">
              명단에 빠진 기존 직원이 없습니다.
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}

function DoneStep({ result, onAgain }: { result: RosterApplyResult; onAgain: () => void }) {
  const items = [
    ['새로 등록', result.created],
    ['정보 변경', result.updated],
    ['그대로', result.unchanged],
    ['퇴직 처리', result.retired],
    ['오류로 제외', result.skipped],
    ['새 부서', result.departmentsCreated],
  ] as const;
  return (
    <div className="rounded-xl border border-line bg-sheet px-6 py-6">
      <div className="flex items-center gap-4">
        <ConfirmStamp animate className="size-14 text-[15px]" />
        <div>
          <p className="text-[16px] font-semibold">명단을 반영했습니다.</p>
          <p className="mt-0.5 text-[13px] text-ink-soft">반영 기록은 감사 로그에 남았습니다.</p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-3 border-t border-l border-line text-center sm:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label} className="border-r border-b border-line px-3 py-3">
            <dt className="text-[12.5px] text-ink-soft">{label}</dt>
            <dd className="mt-0.5 text-[20px] font-semibold tabular-nums">{formatNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex gap-2">
        <Link to="/employees" viewTransition className={buttonClass('primary')}>
          직원 명단 보기
        </Link>
        <Button onClick={onAgain}>다른 파일 올리기</Button>
      </div>
    </div>
  );
}
