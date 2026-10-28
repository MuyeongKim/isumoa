import { describe, expect, it } from 'vitest';
import type { Training } from '../../shared/types.ts';
import { computeStatus } from '../../server/src/certs/status.ts';
import { certificateBaseName, safeName, UniqueNames } from '../../server/src/reports/fileNames.ts';
import { summarizeDashboard } from '../../server/src/reports/statusReport.ts';

describe('내보내기 파일 이름 (Windows 탐색기 기준)', () => {
  it('쓸 수 없는 글자·끝의 점과 빈칸·예약 이름을 피한다', () => {
    expect(safeName('송주주:청렴?<1>/2"|*')).toBe('송주주_청렴__1__2___');
    expect(safeName('과정명 끝에 점...  ')).toBe('과정명 끝에 점');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('CON.txt')).toBe('_CON.txt');
    expect(safeName('nul.tar.gz')).toBe('_nul.tar.gz');
    expect(safeName('COM¹.log')).toBe('_COM¹.log');
    expect(safeName('   ')).toBe('이름없음');
    expect(safeName('홍가길동'.normalize('NFD'))).toBe('홍가길동');
  });

  it('너무 긴 이름은 자른다', () => {
    expect([...safeName('가'.repeat(200))]).toHaveLength(80);
    expect(Buffer.byteLength(safeName('😀'.repeat(100)), 'utf8')).toBeLessThanOrEqual(240);
    const long = certificateBaseName({ departmentName: '부서'.repeat(50), employeeName: '이름'.repeat(25), trainingName: '교육'.repeat(50), completedOn: '2026-01-01' });
    expect([...long].length).toBeLessThanOrEqual(80);
    expect(Buffer.byteLength(long, 'utf8')).toBeLessThanOrEqual(240);
  });

  it('부서_성명_교육명_이수일, 겹치면 (2)를 붙인다 (대소문자 구분 없이)', () => {
    const r = { departmentName: '총무과', employeeName: '오호영', trainingName: '청렴교육(부패방지교육)', completedOn: '2026-05-20' };
    const base = certificateBaseName(r);
    expect(base).toBe('총무과_오호영_청렴교육(부패방지교육)_2026-05-20');
    const names = new UniqueNames();
    expect(names.take('청렴', base, '.pdf')).toBe(`청렴/${base}.pdf`);
    expect(names.take('청렴', base, '.pdf')).toBe(`청렴/${base} (2).pdf`);
    expect(names.take('청렴', base, '.PDF')).toBe(`청렴/${base} (2).PDF`.replace(' (2)', ' (3)'));
    expect(certificateBaseName({ ...r, departmentName: null, completedOn: '' })).toBe('부서없음_오호영_청렴교육(부패방지교육)_이수일없음');
  });
});

describe('대시보드 숫자', () => {
  const training = (id: number): Training => ({
    id,
    code: `t${id}`,
    name: `교육${id}`,
    category: null,
    legalBasis: null,
    reqType: 'count',
    reqValue: 1,
    keywords: [],
    fromYear: null,
    toYear: null,
    active: true,
    sortOrder: id,
    note: null,
  });
  const employee = (id: number, departmentId: number, status: 'active' | 'leave' = 'active') => ({
    id,
    empNo: null,
    name: `직원${id}`,
    departmentId,
    departmentName: `부서${departmentId}`,
    status,
  });

  it('칸 단위 이수율, 부서별 묶음, 휴직자는 이수·미이수 어느 쪽에도 넣지 않는다', () => {
    const report = computeStatus({
      year: 2026,
      trainings: [training(1), training(2)],
      employees: [employee(1, 1), employee(2, 1), employee(3, 2, 'leave')],
      credits: [
        { employeeId: 1, trainingId: 1, certificateId: 1, creditedHours: 1 },
        { employeeId: 1, trainingId: 2, certificateId: 2, creditedHours: 1 },
        { employeeId: 2, trainingId: 1, certificateId: 3, creditedHours: 1 },
      ],
      exemptions: [],
    });
    const d = summarizeDashboard(report, 5);
    expect(d.overall).toEqual({ target: 4, done: 3, partial: 0, rate: 0.75 });
    expect(d.employees).toEqual({ total: 2, complete: 1, missing: 1 });
    expect(d.drafts).toBe(5);
    expect(d.departments).toEqual([
      { departmentId: 1, name: '부서1', employees: 2, complete: 1, missing: 1, rate: 0.75 },
      { departmentId: 2, name: '부서2', employees: 1, complete: 0, missing: 0, rate: null },
    ]);
  });
});
