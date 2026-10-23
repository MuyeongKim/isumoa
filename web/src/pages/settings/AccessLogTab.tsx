import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { AUDIT_ACTIONS } from '@shared/auditActions.ts';
import type { AccessLogPage, AccessReview, ChainCheckView, LogIntegrity } from '@shared/types.ts';
import { EmptyState, LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api, errorMessage } from '@/lib/api';
import { cn, formatNumber } from '@/lib/format';

// 설정 > 접속기록: 월 1회 점검(사용자별 요약·내려받기 사유), 기록 위·변조 확인, 접속기록 찾기

const SECONDS = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' });

function thisMonth(offset = 0): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(d).slice(0, 7);
}

/** 주소의 %EC%B4%9D 같은 부분을 읽을 수 있게 (잘못된 값이면 그대로) */
function readable(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('sv-SE').format(d);
}

function MonthlyReview() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth(-1));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const review = useQuery({ queryKey: ['access-review', month], queryFn: () => api.get<AccessReview>(`/access-log/review?month=${month}`) });
  const data = review.data;

  async function markReviewed(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/access-log/review', { month, note });
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['access-review', month] });
      toast.success(`${month} 접속기록 점검을 기록했습니다.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold">월 점검</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            매달 한 번 접속기록을 점검합니다. 내려받기가 많거나 야간·주말 접속, 로그인 실패가 이어지는 계정이 있는지, 내려받은 사유가 적절한지 확인하세요.
          </p>
        </div>
        <Input type="month" className="w-40" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="점검할 달" />
      </div>

      {review.isPending || !data ? (
        <LoadingRows />
      ) : (
        <div className="mt-4 space-y-4">
          {data.users.length === 0 ? (
            <p className="text-[13.5px] text-ink-faint">이 달의 접속기록이 없습니다.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>사용자</Th>
                  <Th className="w-24 text-right">요청</Th>
                  <Th className="w-24 text-right">조회</Th>
                  <Th className="w-24 text-right">변경</Th>
                  <Th className="w-24 text-right">내려받기</Th>
                  <Th className="w-28 text-right">야간·주말</Th>
                  <Th className="w-28 text-right">로그인 실패</Th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {data.users.map((u) => (
                  <Tr key={u.userLogin}>
                    <Td className="font-medium">
                      {u.userName ?? u.userLogin}
                      {u.userName && <span className="ml-1 font-normal text-ink-faint">({u.userLogin})</span>}
                    </Td>
                    <Td className="text-right">{formatNumber(u.requests)}</Td>
                    <Td className="text-right">{formatNumber(u.views)}</Td>
                    <Td className="text-right">{formatNumber(u.changes)}</Td>
                    <Td className={cn('text-right', u.downloads > 0 && 'font-semibold')}>{formatNumber(u.downloads)}</Td>
                    <Td className={cn('text-right', u.afterHours > 0 && 'font-semibold text-warn')}>{formatNumber(u.afterHours)}</Td>
                    <Td className={cn('text-right', u.failedLogins >= 5 && 'font-semibold text-seal')}>{formatNumber(u.failedLogins)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}

          <div>
            <h3 className="text-[14px] font-semibold">내려받기와 사유 ({formatNumber(data.downloads.length)}건)</h3>
            {data.downloads.length === 0 ? (
              <p className="mt-1 text-[13px] text-ink-faint">이 달에 내려받은 자료가 없습니다.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-md border border-line text-[13px]">
                {data.downloads.map((d, i) => (
                  <li key={i} className="grid grid-cols-[150px_150px_130px_minmax(0,1fr)] gap-3 px-3 py-1.5">
                    <span className="text-ink-soft tabular-nums">{SECONDS.format(new Date(d.at))}</span>
                    <span>{d.userName ?? d.userLogin}</span>
                    <span>{AUDIT_ACTIONS[d.action]?.label ?? d.action}</span>
                    <span className={cn(!d.reason && 'text-ink-faint')}>
                      {d.reason ?? '(사유 없음)'}
                      {d.scope && <span className="ml-1 text-ink-faint">· {d.scope}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.reviewed ? (
            <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft px-4 py-2 text-[13.5px] text-ok">
              <CircleCheck className="size-4" aria-hidden />
              {SECONDS.format(new Date(data.reviewed.at))}에 {data.reviewed.by}이(가) 점검했습니다{data.reviewed.note ? ` — ${data.reviewed.note}` : ''}.
            </p>
          ) : (
            <form onSubmit={markReviewed} className="flex flex-wrap items-center gap-2">
              <Input className="w-96" value={note} onChange={(e) => setNote(e.target.value)} placeholder="점검 메모 (예: 이상 없음, 김OO 야간 접속은 초과근무 확인)" maxLength={500} aria-label="점검 메모" />
              <Button type="submit" variant="primary" loading={saving}>
                점검 완료로 기록
              </Button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function ChainLine({ label, check }: { label: string; check: ChainCheckView }) {
  return (
    <li className={cn('flex items-start gap-2', check.ok ? 'text-ok' : 'text-seal')}>
      {check.ok ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>
        <b className="font-semibold">{label}</b>{' '}
        {check.ok
          ? `정상 — ${formatNumber(check.checked)}건이 처음부터 끝까지 이어집니다${check.trimmed ? ' (보관기간이 지난 앞부분은 정리됨)' : ''}.`
          : `이상 — #${check.brokenAt}: ${check.problem}`}
      </span>
    </li>
  );
}

function Integrity() {
  const [result, setResult] = useState<LogIntegrity | null>(null);
  const [checking, setChecking] = useState(false);

  async function verify() {
    setChecking(true);
    try {
      setResult(await api.post<LogIntegrity>('/logs/verify'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-sheet p-6 shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[72ch]">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <ShieldCheck className="size-4 text-navy" aria-hidden />
            기록 위·변조 확인
          </h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            감사 로그와 접속기록은 앞 기록과 이어지는 고유값(해시)을 함께 저장합니다. 누군가 DB에서 기록을 고치거나 지우면 여기서 드러납니다.
          </p>
        </div>
        <Button onClick={() => void verify()} loading={checking}>
          지금 확인
        </Button>
      </div>
      {result && (
        <ul className="mt-3 space-y-1 text-[13.5px]">
          <ChainLine label="감사 로그" check={result.audit} />
          <ChainLine label="접속기록" check={result.access} />
        </ul>
      )}
    </section>
  );
}

interface Filter {
  from: string;
  to: string;
  user: string;
  q: string;
}

function Search() {
  const [filter, setFilter] = useState<Filter>({ from: daysAgo(7), to: daysAgo(0), user: '', q: '' });
  const [draft, setDraft] = useState(filter);
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page) });
  for (const [k, v] of Object.entries(filter)) if (v.trim()) query.set(k, v.trim());
  const log = useQuery({
    queryKey: ['access-log', query.toString()],
    queryFn: () => api.get<AccessLogPage>(`/access-log?${query}`),
    placeholderData: keepPreviousData,
  });
  const data = log.data;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <section className="space-y-3">
      <h2 className="text-[16px] font-semibold">접속기록 찾기</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(draft);
          setPage(1);
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <span className="flex items-center gap-1.5 text-[13px]">
          <Input type="date" className="w-40" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="시작일" />
          ~
          <Input type="date" className="w-40" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="종료일" />
        </span>
        <Input className="w-40" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} placeholder="사용자" aria-label="사용자" />
        <Input className="w-56" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder="주소에 든 말 (예: exports)" aria-label="주소" />
        <Button type="submit" variant="primary">
          찾기
        </Button>
      </form>
      {log.isPending || !data ? (
        <LoadingRows />
      ) : data.total === 0 ? (
        <EmptyState title="기록이 없습니다" description="기간이나 사용자를 바꿔 보세요." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th className="w-44">시각</Th>
                <Th className="w-40">사용자</Th>
                <Th className="w-16">방식</Th>
                <Th>주소</Th>
                <Th className="w-16 text-right">결과</Th>
                <Th className="w-32">접속 IP</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-[13px] whitespace-nowrap text-ink-soft tabular-nums">{SECONDS.format(new Date(e.at))}</Td>
                  <Td className="text-[13px]">
                    {e.userName ?? e.userLogin}
                    {e.userName && <span className="ml-1 text-ink-faint">({e.userLogin})</span>}
                  </Td>
                  <Td className="text-[12.5px] text-ink-soft">{e.method}</Td>
                  <Td className="max-w-0 truncate font-mono text-[12.5px]" title={readable(e.path)}>
                    {readable(e.path)}
                  </Td>
                  <Td className={cn('text-right text-[13px] tabular-nums', e.status >= 400 ? 'text-seal' : 'text-ink-soft')}>{e.status}</Td>
                  <Td className="text-[13px] text-ink-faint tabular-nums">{e.ip}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between text-[13px] text-ink-soft">
            <span className="tabular-nums">
              {formatNumber(data.total)}건 중 {formatNumber((data.page - 1) * data.pageSize + 1)}–{formatNumber(last)}
            </span>
            <span className="flex gap-2">
              <Button size="sm" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>
                이전
              </Button>
              <Button size="sm" disabled={last >= data.total} onClick={() => setPage(data.page + 1)}>
                다음
              </Button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export function AccessLogTab() {
  return (
    <div className="space-y-6">
      <MonthlyReview />
      <Integrity />
      <Search />
    </div>
  );
}
