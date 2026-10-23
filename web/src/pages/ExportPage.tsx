import { useQuery } from '@tanstack/react-query';
import { FileArchive, FilePen, FileSpreadsheet, FileStack, Download } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Department, ExportSummary, FormTemplate, ZipLayout } from '@shared/types.ts';
import { LoadingRows, PageHeader } from '@/components/PageHeader';
import { buttonClass } from '@/components/ui/Button';
import { withBase } from '@/lib/base';
import { Input, Select } from '@/components/ui/Field';
import { api } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';
import { useCurrentUser } from '@/lib/session';

// 내보내기: 확정한 이수증으로 이수 현황 엑셀, 이수증 ZIP, 교육별 합본 PDF를 받는다.
// 내려받기는 보통 링크(GET)라서 브라우저의 내려받기 표시가 그대로 뜬다.
// 개인정보가 든 자료라 사유를 먼저 고르게 하고, 사유는 감사 로그에 남는다.

const REASONS = ['연간 이수 현황 보고', '감사·점검 제출', '부서 미이수자 독려', '증빙 자료 보관'];
const OTHER = '기타';

function DownloadLink({ href, disabled, children, primary }: { href: string; disabled?: boolean; children: ReactNode; primary?: boolean }) {
  const style = buttonClass(primary ? 'primary' : 'secondary');
  if (disabled) {
    return (
      <span aria-disabled className={cn(style, 'cursor-not-allowed opacity-50')}>
        <Download className="size-4" aria-hidden />
        {children}
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
function FormCard({ departmentId, downloadQuery, noReason, canSplit }: { departmentId: number | null; downloadQuery: string; noReason: boolean; canSplit: boolean }) {
  const forms = useQuery({ queryKey: ['forms'], queryFn: () => api.get<FormTemplate[]>('/forms') });
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
          <Link to="/export/forms" viewTransition className="font-semibold text-link hover:underline">
            양식 올리기·관리
          </Link>
        </>
      }
    >
      {forms.isPending ? null : list.length === 0 ? (
        <Link to="/export/forms" viewTransition className={buttonClass('secondary')}>
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
  const [layout, setLayout] = useState<ZipLayout>('training');
  const [zipTraining, setZipTraining] = useState<number | null>(null);
  const [reasonChoice, setReasonChoice] = useState('');
  const [reasonText, setReasonText] = useState('');
  const reason = reasonChoice === OTHER ? reasonText.trim() : reasonChoice;
  const noReason = reason.length < 2;

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Department[]>('/departments') });
  const scopeQuery = `year=${year}${departmentId ? `&departmentId=${departmentId}` : ''}`;
  const downloadQuery = `${scopeQuery}&reason=${encodeURIComponent(reason)}`;
  const summary = useQuery({
    queryKey: ['exports', year, departmentId],
    queryFn: () => api.get<ExportSummary>(`/exports/summary?${scopeQuery}`),
  });

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  const data = summary.data;
  const zipFiles = data ? (zipTraining ? (data.trainings.find((t) => t.trainingId === zipTraining)?.certificates ?? 0) : data.trainings.reduce((a, t) => a + t.certificates, 0)) : 0;

  return (
    <>
      <PageHeader
        title="내보내기"
        description="확정한 이수증으로 이수 현황 엑셀과 증빙 자료를 만듭니다. 받은 기록은 감사 로그에 남습니다."
        actions={
          <>
            <Select className="w-32" value={year} onChange={(e) => setParam('year', e.target.value)} aria-label="연도">
              {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </Select>
            <Select className="w-44" value={departmentId ?? ''} onChange={(e) => setParam('departmentId', e.target.value || null)} aria-label="부서">
              <option value="">{me.role === 'admin' ? '전체 부서' : '담당 부서 전체'}</option>
              {(departments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {summary.isPending || !data ? (
        <LoadingRows />
      ) : (
        <div className="space-y-4">
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
            <label className="text-[13px]">
              <span className="mb-1.5 block font-semibold">
                내려받는 사유<span className="ml-0.5 text-seal">*</span>
              </span>
              <Select className="w-56" value={reasonChoice} onChange={(e) => setReasonChoice(e.target.value)}>
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
            <p className="text-[12.5px] text-ink-faint">직원 개인정보가 든 자료라 사유를 함께 기록합니다. 관리자가 매달 접속기록을 점검할 때 확인합니다.</p>
          </section>

          <Card
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
          </Card>

          <FormCard
            departmentId={departmentId}
            downloadQuery={downloadQuery}
            noReason={noReason}
            canSplit={departmentId === null && (me.role === 'admin' || me.departments.length > 1)}
          />

          <Card
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
              >
                ZIP 받기 ({formatNumber(zipFiles)}개 파일)
              </DownloadLink>
            </div>
          </Card>

          <Card
            icon={<FileStack className="size-5" aria-hidden />}
            title="교육별 합본 PDF"
            description="교육 하나의 이수증을 부서·성명 순서로 한 파일에 모읍니다. 감사·점검 때 제출 자료로 씁니다."
          >
            <ul className="divide-y divide-line rounded-md border border-line">
              {data.trainings.map((t) => (
                <li key={t.trainingId} className="flex items-center gap-4 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                  <span className="w-20 text-right text-[13px] text-ink-soft tabular-nums">{formatNumber(t.certificates)}장</span>
                  <a
                    href={withBase(`/api/exports/merged.pdf?${downloadQuery}&trainingId=${t.trainingId}`)}
                    download
                    aria-disabled={t.certificates === 0 || noReason}
                    className={cn(
                      'w-20 text-right text-[13.5px]',
                      t.certificates === 0 || noReason ? 'pointer-events-none text-ink-faint' : 'text-link hover:underline',
                    )}
                    tabIndex={t.certificates === 0 || noReason ? -1 : undefined}
                  >
                    PDF 받기
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
