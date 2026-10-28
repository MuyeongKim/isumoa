import { useQuery } from '@tanstack/react-query';
import { FileArchive, FilePen, FileSpreadsheet, FileStack, Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Department, ExportSummary, FormTemplate, ZipLayout } from '@shared/types.ts';
import { DEFAULT_PERSONAL_TITLE, personalArchiveTitleError, personalTitle, personalTitleError } from '@shared/exportTitles.ts';
import { EmptyState, LoadingRows, PageHeader } from '@/components/PageHeader';
import { Button, buttonClass } from '@/components/ui/Button';
import { withBase } from '@/lib/base';
import { Field, Input, Select } from '@/components/ui/Field';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';

// 내보내기: 확정한 이수증으로 이수 현황 엑셀, 이수증 ZIP, 교육별 합본 PDF를 받는다.
// 내려받기는 보통 링크(GET)라서 브라우저의 내려받기 표시가 그대로 뜬다.
// 개인정보가 든 자료라 사유를 먼저 고르게 하고, 사유는 감사 로그에 남는다.

const REASONS = ['연간 이수 현황 보고', '감사·점검 제출', '부서 미이수자 독려', '증빙 자료 보관'];
const OTHER = '기타';
const PURPOSES = [
  { key: 'status', label: '현황 엑셀' },
  { key: 'personal', label: '개인별 합본 PDF' },
  { key: 'training', label: '교육별 합본 PDF' },
  { key: 'files', label: '개별 수료증 ZIP' },
  { key: 'form', label: '기관 제출 양식' },
] as const;

function reasonFocus() {
  const field = document.getElementById('export-reason');
  field?.scrollIntoView({ block: 'center' });
  field?.focus({ preventScroll: true });
}

function DownloadLink({ href, disabled, children, primary, disabledReason = '내려받는 사유를 먼저 선택해 주세요.', showHint = true }: { href: string; disabled?: boolean; children: ReactNode; primary?: boolean; disabledReason?: string; showHint?: boolean }) {
  const style = buttonClass(primary ? 'primary' : 'secondary');
  if (disabled) {
    return (
      <span className="inline-flex flex-col items-start gap-1.5">
      <button type="button" disabled title={disabledReason} className={cn(style, 'opacity-50')}>
        <Download className="size-4" aria-hidden />
        {children}
      </button>
      {showHint && <span className="text-[12.5px] text-ink-soft">{disabledReason}</span>}
      </span>
    );
  }
  return (
    <a href={href} download className={style}>
      <Download className="size-4" aria-hidden />
      {children}
    </a>
  );
}

function Card({ icon, title, description, children }: { icon: ReactNode; title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-navy">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <div className="mt-1 text-[13.5px] text-ink-soft">{description}</div>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** 제출 양식에 채우기: 고른 부서의 양식이 있으면 먼저 고른다 */
function FormCard({ active, departmentId, downloadQuery, noReason, canSplit }: { active: boolean; departmentId: number | null; downloadQuery: string; noReason: boolean; canSplit: boolean }) {
  const forms = useQuery({ queryKey: ['forms'], queryFn: () => api.get<FormTemplate[]>('/forms'), enabled: active });
  const [formId, setFormId] = useState<number | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [split, setSplit] = useState(false);
  const list = forms.data ?? [];

  useEffect(() => {
    if (list.length === 0) return;
    const preferred = list.find((f) => f.departmentId === departmentId) ?? list.find((f) => f.departmentId === null) ?? list[0];
    setFormId((current) => (current !== null && list.some((f) => f.id === current) ? current : preferred.id));
  }, [list, departmentId]);

  return (
    <Card
      icon={<FilePen className="size-5" aria-hidden />}
      title="제출 양식에 채우기"
      description={
        <>
          기관·부서가 정한 엑셀 양식에 직원 한 줄씩 이수 현황을 채웁니다. 양식의 제목·머리글·합계·서명란은 그대로 둡니다.{' '}
          <Link to="/export/forms" className="font-semibold text-link hover:underline">
            양식 올리기·관리
          </Link>
        </>
      }
    >
      {forms.isPending ? null : list.length === 0 ? (
        <Link to="/export/forms" className={buttonClass('secondary')}>
          제출 양식 올리기
        </Link>
      ) : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Select className="w-64" value={formId ?? ''} onChange={(e) => setFormId(Number(e.target.value))} aria-label="제출 양식">
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.departmentName ? ` (${f.departmentName})` : ''}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2 text-[14px] text-ink-soft">
            <input type="checkbox" className="size-4 accent-navy" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
            미이수·부분이수 직원만
          </label>
          {canSplit && (
            <label className="flex items-center gap-2 text-[14px] text-ink-soft">
              <input type="checkbox" className="size-4 accent-navy" checked={split} onChange={(e) => setSplit(e.target.checked)} />
              부서별 파일로 나누기 (ZIP)
            </label>
          )}
          <DownloadLink
            primary
            href={withBase(`/api/exports/form?${downloadQuery}&formId=${formId}${onlyMissing ? '&onlyMissing=1' : ''}${split && canSplit ? '&split=1' : ''}`)}
            disabled={noReason || formId === null}
          >
            양식에 채워 받기
          </DownloadLink>
        </div>
      )}
    </Card>
  );
}

export function ExportPage() {
  const me = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const thisYear = new Date().getFullYear();
  const year = Number(params.get('year')) || thisYear;
  const departmentId = Number(params.get('departmentId')) || null;
  const purpose = PURPOSES.find(p => p.key === params.get('purpose'))?.key ?? 'status';
  const [layout, setLayout] = useState<ZipLayout>('training');
  const [zipTraining, setZipTraining] = useState<number | null>(null);
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [personalTemplate, setPersonalTemplate] = useState(DEFAULT_PERSONAL_TITLE);
  const [archiveTitle, setArchiveTitle] = useState('');
  const [personalEmployee, setPersonalEmployee] = useState<number | null>(null);
  const reason = reasonChoice === OTHER ? reasonText.trim() : reasonChoice;
  const noReason = reason.length < 2;
  const personalError = personalTitleError(personalTemplate);
  const archiveError = personalArchiveTitleError(archiveTitle);

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const scopeQuery = `year=${year}${departmentId ? `&departmentId=${departmentId}` : ''}`;
  const downloadQuery = `${scopeQuery}&reason=${encodeURIComponent(reason)}`;
  const summary = useQuery({
    queryKey: ['exports', year, departmentId],
    queryFn: () => api.get<ExportSummary>(`/exports/summary?${scopeQuery}`),
  });

  function setParam(key: string, value: string | null) {
    if (key === 'year' || key === 'departmentId') setPersonalEmployee(null);
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const data = summary.data;
  const examplePerson = data?.employees?.find(p => p.employeeId === personalEmployee) ?? data?.employees?.[0];
  const personalFileExample = personalTitle(personalTemplate.trim(), { 연도: String(year), 부서: examplePerson?.departmentName ?? '총무과', 성명: examplePerson?.name ?? '홍길동', 사번: examplePerson?.empNo ?? String(examplePerson?.employeeId ?? '1001') });
  const zipFiles = data ? (zipTraining ? (data.trainings.find((t) => t.trainingId === zipTraining)?.certificates ?? 0) : data.trainings.reduce((a, t) => a + t.certificates, 0)) : 0;

  return (
    <>
      <PageHeader
        title="내보내기"
        description="확정한 이수증으로 이수 현황 엑셀과 증빙 자료를 만듭니다. 받은 기록은 감사 로그에 남습니다."
      />

      {summary.isError ? <EmptyState title="내보낼 자료를 불러오지 못했습니다" description={errorMessage(summary.error)} action={<Button onClick={() => void summary.refetch()}>다시 불러오기</Button>} /> : summary.isPending || !data ? (
        <LoadingRows />
      ) : (
        <div className="space-y-4">
          <fieldset className="rounded-2xl border border-line bg-sheet px-6 py-5 shadow-surface">
            <legend className="px-1 text-[14px] font-semibold">1. 받을 자료 고르기</legend>
            <div className="flex flex-wrap gap-2">
              {PURPOSES.map(option => <label key={option.key} className="cursor-pointer">
                <input type="radio" name="export-purpose" className="peer sr-only" checked={purpose === option.key} onChange={() => setParam('purpose', option.key)} />
                <span className="inline-flex rounded-lg border border-line-strong px-3.5 py-2 text-[14px] font-semibold transition-colors peer-checked:border-navy peer-checked:bg-navy-soft peer-checked:text-navy peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-link">{option.label}</span>
              </label>)}
            </div>
          </fieldset>
          {data.drafts > 0 && (
            <p className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/40 bg-warn-soft px-5 py-3 text-[14px]">
              <span>
                검수 대기 이수증 <span className="font-semibold tabular-nums">{formatNumber(data.drafts)}건</span>은 아직 확정하지 않아 내보내기에 들어가지 않습니다.
              </span>
              <Link to="/review" className="text-[13.5px] font-medium text-link hover:underline">
                검수함으로 가기
              </Link>
            </p>
          )}

          <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-sheet px-6 py-5 shadow-surface">
            <h2 className="w-full text-[14px] font-semibold">2. 범위와 내려받는 사유</h2>
            <label className="text-[13px]"><span className="mb-1.5 block font-semibold">연도</span>
              <Select className="w-28" value={year} onChange={e => setParam('year', e.target.value)} aria-label="연도">
                {[thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}년</option>)}
              </Select>
            </label>
            <label className="text-[13px]"><span className="mb-1.5 block font-semibold">부서</span>
              <Select className="w-40" value={departmentId ?? ''} onChange={e => setParam('departmentId', e.target.value || null)} aria-label="부서">
                <option value="">{me.role === 'admin' ? '전체 부서' : '담당 부서 전체'}</option>
                {(departments.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </label>
            <label className="text-[13px]">
              <span className="mb-1.5 block font-semibold">
                내려받는 사유<span className="ml-0.5 text-seal">*</span>
              </span>
              <Select id="export-reason" className="w-56" value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
                <option value="">사유를 고르세요</option>
                {[...REASONS, OTHER].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </label>
            {reasonChoice === OTHER && (
              <Input className="w-72" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="사유를 적어 주세요" maxLength={100} aria-label="기타 사유" />
            )}
            <p className="w-full text-[12.5px] text-ink-faint">직원 개인정보가 든 자료라 내려받는 사유를 기록합니다. 사유를 선택하면 다운로드가 활성화됩니다.</p>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-paper px-4 py-3 text-[13px] text-ink-soft" role="status">
            <span>{year}년 · {departmentId ? departments.data?.find(d => d.id === departmentId)?.name ?? '선택한 부서' : me.role === 'admin' ? '전체 부서' : '담당 부서'} · 확정 수료증 {formatNumber(data.certificates)}장</span>
            {noReason && <Button size="sm" onClick={reasonFocus}>사유 선택으로 이동</Button>}
          </div>

          {purpose === 'status' && <Card
            icon={<FileSpreadsheet className="size-5" aria-hidden />}
            title="이수 현황 엑셀"
            description={
              <ul className="list-disc space-y-0.5 pl-4">
                <li>
                  <b className="font-medium text-ink">요약</b> — 교육별 대상·이수·미이수 인원과 부서별 이수율
                </li>
                <li>
                  <b className="font-medium text-ink">직원별</b> — 직원 × 교육 이수 여부 (필터로 부서·미이수만 골라 볼 수 있음)
                </li>
                <li>
                  <b className="font-medium text-ink">미이수자</b> — 미이수·부분이수만 한 줄씩 (부서별 독려 명단)
                </li>
                <li>
                  <b className="font-medium text-ink">상세 내역</b> — 근거가 된 이수증 (이수일, 과정명, 교육기관, 원본 파일, 확정한 사람)
                </li>
              </ul>
            }
          >
            <DownloadLink primary href={withBase(`/api/exports/status.xlsx?${downloadQuery}`)} disabled={noReason}>
              엑셀 받기
            </DownloadLink>
          </Card>}

          <div hidden={purpose !== 'form'}><FormCard
            active={purpose === 'form'}
            departmentId={departmentId}
            downloadQuery={downloadQuery}
            noReason={noReason}
            canSplit={departmentId === null && (me.role === 'admin' || me.departments.length > 1)}
          /></div>

          {purpose === 'files' && <Card
            icon={<FileArchive className="size-5" aria-hidden />}
            title="이수증 ZIP"
            description={
              <>
                확정한 이수증을 한 장씩 PDF로 담습니다. 파일 이름은 <code className="rounded bg-paper px-1">부서_성명_교육명_이수일.pdf</code>이고, 통합과정 이수증은 인정된 교육마다 들어갑니다.
              </>
            }
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <fieldset className="flex gap-4 text-[14px]">
                <legend className="sr-only">폴더 나누기</legend>
                {(
                  [
                    ['training', '교육별 폴더'],
                    ['department', '부서별 폴더'],
                    ['employee', '개인별 폴더'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-1.5">
                    <input type="radio" name="layout" className="size-4 accent-navy" checked={layout === value} onChange={() => setLayout(value)} />
                    {label}
                  </label>
                ))}
              </fieldset>
              <Select className="w-56" value={zipTraining ?? ''} onChange={(e) => setZipTraining(Number(e.target.value) || null)} aria-label="교육">
                <option value="">모든 교육</option>
                {data.trainings.map((t) => (
                  <option key={t.trainingId} value={t.trainingId}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <DownloadLink
                href={withBase(`/api/exports/certificates.zip?${downloadQuery}&layout=${layout}${zipTraining ? `&trainingId=${zipTraining}` : ''}`)}
                disabled={zipFiles === 0 || noReason}
                disabledReason={noReason ? undefined : '선택한 범위에 확정한 수료증이 없습니다.'}
              >
                ZIP 받기 ({formatNumber(zipFiles)}개 파일)
              </DownloadLink>
            </div>
          </Card>}

          {purpose === 'personal' && <Card icon={<FileStack className="size-5" aria-hidden />} title="개인별 합본 PDF"
            description="직원 한 명의 이수증을 PDF 한 파일로 모아 ZIP으로 받습니다. 통합과정의 같은 쪽은 한 번만 담고, 제목은 PDF 문서 제목과 파일 이름에 반영합니다.">
            <div className="space-y-4">
              <Field label="대상 직원" htmlFor="personal-employee">
                <Select id="personal-employee" value={personalEmployee ?? ''} onChange={e => setPersonalEmployee(Number(e.target.value) || null)}>
                  <option value="">선택한 범위의 모든 직원 ({data.employees?.length ?? 0}명)</option>
                  {(data.employees ?? []).map(person => <option key={person.employeeId} value={person.employeeId}>{person.departmentName ?? '부서없음'} · {person.name}{person.empNo ? ` (${person.empNo})` : ''} · {person.certificates}장</option>)}
                </Select>
              </Field>
              <Field label="개인별 PDF 제목" htmlFor="personal-title" hint={<span id="personal-title-hint">{'{연도}, {부서}, {성명}, {사번}'}을 넣으면 직원별 값으로 바뀝니다. 같은 파일명이 생기면 번호를 붙입니다.</span>}>
                <Input id="personal-title" value={personalTemplate} maxLength={150} onChange={e => setPersonalTemplate(e.target.value)}
                  aria-invalid={Boolean(personalError)} aria-describedby={personalError ? 'personal-title-error personal-title-hint' : 'personal-title-hint'} />
                {personalError && <p id="personal-title-error" role="alert" className="text-[12.5px] text-seal">{personalError}</p>}
              </Field>
              <p className="rounded-lg bg-paper px-3 py-2 text-[13px] break-all text-ink-soft" aria-live="polite">{personalError ? '제목을 고치면 파일명 예시가 표시됩니다.' : `파일명 예시: ${personalFileExample}.pdf`}</p>
              <Field label="ZIP 파일 제목" htmlFor="personal-archive-title" hint={<span id="personal-archive-hint">ZIP 전체에 쓰는 고정 제목입니다. 비워 두면 기본 제목으로 받으며, 확장자는 자동으로 붙습니다.</span>}>
                <Input id="personal-archive-title" value={archiveTitle} maxLength={100} placeholder={`${year}년_개인별_이수증`} onChange={e => setArchiveTitle(e.target.value)}
                  aria-invalid={Boolean(archiveError)} aria-describedby={archiveError ? 'personal-archive-error personal-archive-hint' : 'personal-archive-hint'} />
                {archiveError && <p id="personal-archive-error" role="alert" className="text-[12.5px] text-seal">{archiveError}</p>}
              </Field>
              <DownloadLink primary disabled={noReason || !data.employees?.length || Boolean(personalError || archiveError)}
                disabledReason={noReason ? undefined : !data.employees?.length ? '선택한 범위에 확정한 수료증이 없습니다.' : personalError ?? archiveError ?? undefined}
                href={withBase(`/api/exports/employees.zip?${downloadQuery}&title=${encodeURIComponent(personalTemplate)}${archiveTitle.trim() ? `&archiveTitle=${encodeURIComponent(archiveTitle.trim())}` : ''}${personalEmployee ? `&employeeId=${personalEmployee}` : ''}`)}>개인별 PDF 묶음 받기</DownloadLink>
            </div>
          </Card>}

          {purpose === 'training' && <Card
            icon={<FileStack className="size-5" aria-hidden />}
            title="교육별 합본 PDF"
            description="교육 하나의 이수증을 부서·성명 순서로 한 파일에 모읍니다. 감사·점검 때 제출 자료로 씁니다."
          >
            {noReason && <p className="mb-3 text-[13px] text-warn">내려받는 사유를 먼저 선택해 주세요. 위의 ‘사유 선택으로 이동’을 누르면 바로 이동합니다.</p>}
            <ul className="divide-y divide-line rounded-md border border-line">
              {data.trainings.map((t) => (
                <li key={t.trainingId} className="flex items-center gap-4 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  <span className="w-20 text-right text-[13px] text-ink-soft tabular-nums">{formatNumber(t.certificates)}장</span>
                  <DownloadLink
                    href={withBase(`/api/exports/merged.pdf?${downloadQuery}&trainingId=${t.trainingId}`)}
                    disabled={t.certificates === 0 || noReason} showHint={false}
                    disabledReason={noReason ? undefined : '이 교육의 확정 수료증이 없습니다.'}
                  >PDF 받기</DownloadLink>
                </li>
              ))}
            </ul>
          </Card>}
        </div>
      )}
    </>
  );
}
