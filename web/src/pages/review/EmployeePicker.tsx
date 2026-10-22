import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Employee, EmployeeCandidate } from '@shared/types.ts';
import { Input } from '@/components/ui/Field';

function describe(e: { departmentName: string | null; empNo: string | null; birthDate: string | null }): string {
  return [e.departmentName, e.empNo, e.birthDate].filter(Boolean).join(' · ');
}

/** 이수증의 주인(직원) 고르기: 자동으로 찾은 후보를 먼저 보여 주고, 이름·사번으로도 찾는다 */
export function EmployeePicker({
  value,
  employees,
  candidates,
  disabled,
  onChange,
}: {
  value: number | null;
  employees: Employee[];
  candidates: EmployeeCandidate[];
  disabled: boolean;
  onChange: (id: number | null) => void;
}) {
  const [query, setQuery] = useState('');
  const selected = employees.find((e) => e.id === value) ?? candidates.find((c) => c.id === value) ?? null;
  const others = candidates.filter((c) => c.id !== value);
  const results = useMemo(() => {
    const word = query.replace(/\s+/g, '');
    if (!word) return [];
    return employees
      .filter((e) => e.status !== 'retired' && (e.name.replace(/\s+/g, '').includes(word) || (e.empNo ?? '').includes(word)))
      .slice(0, 8);
  }, [employees, query]);

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-line-strong bg-sheet px-3 py-2">
          <div className="min-w-0">
            <p className="font-medium">{selected.name}</p>
            <p className="truncate text-[12.5px] text-ink-soft">{describe(selected)}</p>
          </div>
          {!disabled && (
            <button type="button" className="shrink-0 text-[12.5px] text-link hover:underline" onClick={() => onChange(null)}>
              다시 고르기
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-seal/50 bg-seal-soft/50 px-3 py-2 text-[13px] text-seal">
          직원을 정하지 않았습니다.
        </p>
      )}

      {!disabled && others.length > 0 && (
        <div>
          <p className="mb-1 text-[12px] text-ink-faint">후보</p>
          <ul className="space-y-1">
            {others.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChange(c.id)}
                  className="w-full rounded-md border border-line px-3 py-1.5 text-left text-[13px] hover:border-navy/50 hover:bg-navy-soft"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="ml-2 text-ink-soft">{describe(c)}</span>
                  <span className="block text-[12px] text-ink-faint">{c.reason}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!disabled && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-ink-faint" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름이나 사번으로 찾기" className="pl-8" aria-label="직원 찾기" />
          {results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-sheet py-1 shadow-lg">
              {results.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left text-[13px] hover:bg-navy-soft"
                    onClick={() => {
                      onChange(e.id);
                      setQuery('');
                    }}
                  >
                    <span className="font-medium">{e.name}</span>
                    <span className="ml-2 text-ink-soft">{describe(e)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
