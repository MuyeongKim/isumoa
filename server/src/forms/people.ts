import type { Kysely } from 'kysely';
import { shortTrainingName } from '../../../shared/trainingNames.ts';
import type { DB } from '../db/schema.ts';
import { loadRecords } from '../reports/records.ts';
import { loadStatusReport, type ReportScope } from '../reports/statusReport.ts';
import type { FormPerson, FormTrainingValue } from './fill.ts';

// 양식에 쓸 사람별 값: 이수 현황(이수 여부·시간)과 확정 이수증(이수일·과정·기관), 직원 정보(직급·사번 등).
// 순서는 이수 현황 화면과 같다 (부서 → 이름).

export interface FormPersonRow extends FormPerson {
  departmentId: number | null;
}

export async function loadFormPeople(db: Kysely<DB>, filter: ReportScope & { onlyMissing?: boolean }): Promise<FormPersonRow[]> {
  const report = await loadStatusReport(db, filter);
  if (report.rows.length === 0) return [];
  const records = await loadRecords(db, filter);
  const details = new Map(
    (
      await db
        .selectFrom('employees')
        .select(['id', 'position', 'emp_type', 'birth_date'])
        .where(
          'id',
          'in',
          report.rows.map((r) => r.employeeId),
        )
        .execute()
    ).map((e) => [e.id, e]),
  );

  // 직원·교육마다 가장 최근 이수증
  const latest = new Map<string, (typeof records)[number]>();
  for (const rec of records) {
    const key = `${rec.employeeId}:${rec.trainingId}`;
    const prev = latest.get(key);
    if (!prev || rec.completedOn > prev.completedOn) latest.set(key, rec);
  }

  const people = report.rows.map((row): FormPersonRow => {
    const detail = details.get(row.employeeId);
    const trainings: Record<number, FormTrainingValue> = {};
    for (const t of report.trainings) {
      const cell = row.cells[t.id];
      if (!cell) continue;
      const rec = latest.get(`${row.employeeId}:${t.id}`);
      trainings[t.id] = {
        state: cell.state,
        hours: cell.hours,
        date: rec?.completedOn ?? null,
        course: rec?.courseTitle ?? null,
        provider: rec?.provider ?? null,
      };
    }
    return {
      departmentId: row.departmentId,
      name: row.name,
      department: row.departmentName,
      position: detail?.position ?? null,
      empNo: row.empNo,
      birthDate: detail?.birth_date ?? null,
      empType: detail?.emp_type ?? null,
      trainings,
      missing: report.trainings.filter((t) => ['none', 'partial'].includes(row.cells[t.id]?.state ?? '')).map((t) => shortTrainingName(t.name)),
    };
  });
  return filter.onlyMissing ? people.filter((p) => p.missing.length > 0) : people;
}
