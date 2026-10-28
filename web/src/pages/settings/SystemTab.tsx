import { useQuery } from '@tanstack/react-query';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { SystemCheck } from '@shared/types.ts';
import { LoadingRows } from '@/components/PageHeader';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

// 설정 > 시스템 점검: 운영 전에 고칠 점과 서버 상태

function gb(bytes: number | null): string {
  if (bytes === null) return '-';
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)}GB` : `${(bytes / 1024 ** 2).toFixed(1)}MB`;
}

export function SystemTab() {
  const { data } = useQuery({ queryKey: ['system'], queryFn: () => api.get<SystemCheck>('/system') });
  if (!data) return <LoadingRows />;
  const addressHost = ['0.0.0.0', '::'].includes(data.host) ? '서버 IP'
    : data.host.includes(':') && !data.host.startsWith('[') ? `[${data.host}]` : data.host;

  const rows: [string, string][] = [
    ['버전', `v${data.version} · Node ${data.node} · ${data.platform}`],
    ['서버 시작', formatDateTime(data.startedAt)],
    ['접속 주소', `${data.https ? 'https' : 'http'}://${addressHost}:${data.port}`],
    ['HTTPS', data.https ? '켜짐 (이 서버가 인증서로 암호화)' : '꺼짐'],
    ['쿠키 Secure 표시', data.cookieSecure ? '켜짐' : '꺼짐'],
    ['데이터 폴더', data.dataDir],
    ['DB 크기', gb(data.dbBytes)],
    ['디스크', `남은 공간 ${gb(data.freeBytes)} / 전체 ${gb(data.totalBytes)}`],
    ['마지막 백업', data.backup ? `${formatDateTime(data.backup.at)} ${data.backup.ok ? '성공' : `실패 (${data.backup.error})`}` : '없음'],
    ['스캔본 OCR', `${data.ocrEngine} — 이 PC(서버) 안에서만 동작`],
  ];

  return (
    <div className="max-w-4xl space-y-4">
      {data.warnings.length === 0 ? (
        <p className="flex items-center gap-2 rounded-xl border border-ok/30 bg-ok-soft px-4 py-3 text-[14px] text-ok">
          <CircleCheck className="size-4" aria-hidden />
          고칠 점이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {data.warnings.map((w) => (
            <li key={w} className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13.5px] text-ink">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-[140px_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-sheet text-[13.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="border-b border-line bg-head px-4 py-2 font-medium text-ink-soft">{k}</dt>
            <dd className="border-b border-line px-4 py-2 break-all">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
