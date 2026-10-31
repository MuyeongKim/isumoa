import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Employee, EmployeeCandidate } from '@shared/types.ts';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';

function describe(e: { departmentName: string | null; empNo: string | null; birthDate: string | null }): string {
  return [e.departmentName, e.empNo, e.birthDate].filter(Boolean).join(' · ');
}

/** 후보·검색은 별도 창에서 고른다. 취소할 때 기존 직원을 지우지 않는다. */
export function EmployeePicker({ value, employees, candidates, disabled, onChange }: {
  value: number | null; employees: Employee[]; candidates: EmployeeCandidate[]; disabled: boolean; onChange: (id: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = employees.find(e => e.id === value) ?? candidates.find(c => c.id === value) ?? null;
  const results = useMemo(() => {
    const word = query.replace(/\s+/g, '');
    return word ? employees.filter(e => e.status !== 'retired' && (e.name.replace(/\s+/g, '').includes(word) || (e.empNo ?? '').includes(word))).slice(0, 20) : candidates;
  }, [employees, candidates, query]);
  function choose(id: number) { onChange(id); setOpen(false); setQuery(''); }
  return <>
    {selected ? <div className="flex items-center justify-between gap-2 rounded-md border border-line-strong bg-sheet px-3 py-1.5">
      <div className="min-w-0"><p className="text-[13.5px] font-medium">{selected.name}</p><p className="truncate text-[12.5px] text-ink-soft" title={describe(selected)}>{describe(selected)}</p></div>
      {!disabled && <button type="button" className="shrink-0 text-[12.5px] text-link hover:underline" aria-haspopup="dialog" onClick={() => setOpen(true)}>다시 고르기</button>}
    </div> : <Button className="w-full" variant="danger" disabled={disabled} aria-haspopup="dialog" onClick={() => setOpen(true)}>직원을 골라 주세요</Button>}
    <Dialog open={open && !disabled} onClose={() => setOpen(false)} title="직원 선택" description="이름·소속·생년월일을 원본과 대조해 직원을 고르세요. 닫으면 기존 선택을 유지합니다.">
      <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-faint" aria-hidden />
        <Input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="이름이나 사번으로 찾기" className="pl-8" aria-label="직원 찾기" />
      </div>
      <p className="mt-3 text-[12px] text-ink-faint">{query ? '검색 결과' : '원본에서 찾은 후보'}</p>
      <ul className="mt-2 max-h-[45dvh] space-y-1 overflow-y-auto">{results.map(e => <li key={e.id}>
        <button type="button" className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-navy/50 hover:bg-navy-soft" onClick={() => choose(e.id)}>
          <span className="text-[14px] font-semibold">{e.name}</span><span className="mt-0.5 block text-[12.5px] text-ink-soft">{describe(e)}</span>
        </button>
      </li>)}</ul>
      {!results.length && <p className="mt-3 text-[13px] text-ink-soft">{query ? '맞는 직원이 없습니다. 직원 명단에 먼저 등록했는지 확인해 주세요.' : '이름이나 사번으로 검색해 주세요.'}</p>}
    </Dialog>
  </>;
}
