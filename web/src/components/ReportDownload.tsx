import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { FormError } from './ui/Field';
import { errorMessage } from '@/lib/api';

/** 양식 오류를 JSON 새 화면 대신 현재 화면에 안내한다. XLSX·부서별 양식 ZIP용. */
export function ReportDownload({ href, disabled, disabledReason, label }: { href: string; disabled: boolean; disabledReason?: string; label: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [href, disabled]);
  async function download() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(href, { credentials: 'same-origin' });
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message ?? `양식을 만들지 못했습니다 (${response.status}).`); }
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const filename = encoded ? decodeURIComponent(encoded) : /filename="([^"]+)"/i.exec(disposition)?.[1] ?? '보고양식.xlsx';
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a');
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2"><Button variant="primary" disabled={disabled || busy} loading={busy} onClick={() => void download()}>{busy ? '양식을 만드는 중입니다' : label}</Button>{disabled && disabledReason && <p className="text-[12.5px] text-ink-soft">{disabledReason}</p>}<FormError message={error}/></div>;
}
