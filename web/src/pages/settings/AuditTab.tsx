import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AUDIT_ACTIONS, AUDIT_CATEGORIES, type AuditCategory } from '@shared/auditActions.ts';
import type { AuditEntry, AuditPage } from '@shared/types.ts';
import { EmptyState, LoadingRows } from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Table, Td, Th, Tr } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';

// 설정 > 감사 로그: 누가 언제 무엇을 했는지. 기간·작업 종류·사용자로 찾는다.

const TARGET_LABELS: Record<string, string> = {
  user: '계정',
  department: '부서',
  employee: '직원',
  roster: '명단 파일',
  batch: '묶음',
  file: '파일',
  certificate: '이수증',
  training: '교육',
};

const DETAIL_LABELS: Record<string, string> = {
  year: '연도',
  scope: '범위',
  employees: '직원',
  certificates: '이수증',
  files: '파일',
  layout: '폴더',
  training: '교육',
  trainingId: '교육 번호',
  reason: '사유',
  fields: '바꾼 항목',
  confirmed: '확정',
  skipped: '남김',
  pages: '쪽',
  from: '이전 상태',
  provider: '종류',
  baseUrl: '주소',
  model: '모델',
  enabled: '사용',
  external: '기관 밖',
  ok: '결과',
  apiKeyChanged: 'API 키 변경',
  orgName: '기관명',
  name: '이름',
};

const VALUE_LABELS: Record<string, string> = { training: '교육별', department: '부서별', draft: '검수 대기', confirmed: '확정', excluded: '제외' };

function detailText(detail: AuditEntry['detail']): string {
  if (!detail) return '';
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => {
      const value =
        typeof v === 'boolean' ? (v ? '예' : '아니오') : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : (VALUE_LABELS[String(v)] ?? String(v));
      return `${DETAIL_LABELS[k] ?? k}: ${value}`;
    })
    .join(' · ');
}

const SECONDS = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' });

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('sv-SE').format(d);
}

interface Filter {
  from: string;
  to: string;
  category: AuditCategory | '';
  user: string;
}

export function AuditTab() {
  const [filter, setFilter] = useState<Filter>({ from: daysAgo(30), to: daysAgo(0), category: '', user: '' });
  const [draft, setDraft] = useState<Filter>(filter);
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page) });
  if (filter.from) query.set('from', filter.from);
  if (filter.to) query.set('to', filter.to);
  if (filter.category) query.set('category', filter.category);
  if (filter.user.trim()) query.set('user', filter.user.trim());
  const log = useQuery({
    queryKey: ['audit', query.toString()],
    queryFn: () => api.get<AuditPage>(`/audit?${query}`),
    placeholderData: keepPreviousData,
  });

  function search(e: FormEvent) {
    e.preventDefault();
    setFilter(draft);
    setPage(1);
  }

  const data = log.data;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? Math.min(data.page * data.pageSize, data.total) : 0;

  return (
    <div className="space-y-4">
      <form onSubmit={search} className="flex flex-wrap items-end gap-2">
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">기간</span>
          <span className="flex items-center gap-1.5">
            <Input type="date" className="w-40" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} aria-label="시작일" />
            ~
            <Input type="date" className="w-40" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} aria-label="종료일" />
          </span>
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">작업</span>
          <Select className="w-40" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Filter['category'] })}>
            <option value="">전체</option>
            {(Object.keys(AUDIT_CATEGORIES) as AuditCategory[]).map((c) => (
              <option key={c} value={c}>
                {AUDIT_CATEGORIES[c]}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-[13px]">
          <span className="mb-1 block font-medium">사용자</span>
          <Input className="w-40" value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} placeholder="아이디 또는 이름" />
        </label>
        <Button type="submit" variant="primary">
          찾기
        </Button>
      </form>

      {log.isPending || !data ? (
        <LoadingRows />
      ) : data.total === 0 ? (
        <EmptyState title="기록이 없습니다" description="기간이나 작업 종류를 바꿔 보세요." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th className="w-40">시각</Th>
                <Th className="w-36">사용자</Th>
                <Th className="w-40">작업</Th>
                <Th className="w-28">대상</Th>
                <Th>내용</Th>
                <Th className="w-32">접속 IP</Th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <Tr key={e.id}>
                  <Td className="text-[13px] whitespace-nowrap text-ink-soft tabular-nums">{SECONDS.format(new Date(e.at))}</Td>
                  <Td className="text-[13px]">
                    {e.userName ?? <span className="text-ink-faint">-</span>}
                    {e.userLogin && <span className="ml-1 text-ink-faint">({e.userLogin})</span>}
                  </Td>
                  <Td className="text-[13px] font-medium">{AUDIT_ACTIONS[e.action]?.label ?? e.action}</Td>
                  <Td className="text-[13px] text-ink-soft">{e.targetType ? `${TARGET_LABELS[e.targetType] ?? e.targetType} ${e.targetId ?? ''}` : ''}</Td>
                  <Td className="text-[13px] text-ink-soft">{detailText(e.detail)}</Td>
                  <Td className="text-[13px] text-ink-faint tabular-nums">{e.ip}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between text-[13px] text-ink-soft">
            <span className="tabular-nums">
              {formatNumber(data.total)}건 중 {formatNumber(first)}–{formatNumber(last)}
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
    </div>
  );
}
