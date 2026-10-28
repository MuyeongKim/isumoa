import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import type { ReportScope } from './statusReport.ts';

// 내보내기에 쓰는 "확정한 이수증 × 인정 교육" 목록.
// 통합과정 이수증 1장이 교육 4개로 인정되면 4줄이 된다 (교육별 증빙으로 각각 필요하므로).

export interface CertificateRecord {
  certificateId: number;
  trainingId: number;
  trainingName: string;
  creditedHours: number | null;
  employeeId: number;
  empNo: string | null;
  employeeName: string;
  departmentId: number | null;
  departmentName: string | null;
  completedOn: string;
  hours: number | null;
  hoursText: string | null;
  courseTitle: string | null;
  provider: string | null;
  certNo: string | null;
  pageId: number;
  pageNo: number;
  fileId: number;
  fileName: string;
  storedName: string;
  mime: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export async function loadRecords(db: Kysely<DB>, filter: ReportScope & { trainingId?: number }): Promise<CertificateRecord[]> {
  const { year, scope, departmentId, trainingId } = filter;
  if (scope && scope.length === 0) return [];
  const rows = await db
    .selectFrom('certificate_trainings as ct')
    .innerJoin('certificates as c', 'c.id', 'ct.certificate_id')
    .innerJoin('trainings as t', 't.id', 'ct.training_id')
    .innerJoin('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .innerJoin('pages as p', 'p.id', 'c.page_id')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .leftJoin('users as u', 'u.id', 'c.confirmed_by')
    .select([
      'c.id as certificate_id',
      't.id as training_id',
      't.name as training_name',
      'ct.credited_hours',
      'e.id as employee_id',
      'e.emp_no',
      'e.name as employee_name',
      'e.department_id',
      'd.name as department_name',
      'c.completed_on',
      'c.hours',
      'c.hours_text',
      'c.course_title',
      'c.provider',
      'c.cert_no',
      'p.id as page_id',
      'p.page_no',
      'f.id as file_id',
      'f.original_name',
      'f.stored_name',
      'f.mime',
      'u.name as confirmed_by_name',
      'c.confirmed_at',
    ])
    .where('e.deleted_at', 'is', null)
    .where('t.deleted_at', 'is', null)
    .where('c.status', '=', 'confirmed')
    .where('c.year', '=', year)
    .$if(scope !== null, (qb) => qb.where('e.department_id', 'in', scope!))
    .$if(departmentId !== undefined, (qb) => qb.where('e.department_id', '=', departmentId!))
    .$if(trainingId !== undefined, (qb) => qb.where('t.id', '=', trainingId!))
    .orderBy('d.sort_order')
    .orderBy('d.name')
    .orderBy('e.name')
    .orderBy('e.id')
    .orderBy('t.sort_order')
    .orderBy('c.completed_on')
    .orderBy('c.id')
    .execute();

  return rows.map((r) => ({
    certificateId: r.certificate_id,
    trainingId: r.training_id,
    trainingName: r.training_name,
    creditedHours: r.credited_hours,
    employeeId: r.employee_id,
    empNo: r.emp_no,
    employeeName: r.employee_name,
    departmentId: r.department_id,
    departmentName: r.department_name,
    completedOn: r.completed_on ?? '',
    hours: r.hours,
    hoursText: r.hours_text,
    courseTitle: r.course_title,
    provider: r.provider,
    certNo: r.cert_no,
    pageId: r.page_id,
    pageNo: r.page_no,
    fileId: r.file_id,
    fileName: r.original_name,
    storedName: r.stored_name,
    mime: r.mime,
    confirmedBy: r.confirmed_by_name,
    confirmedAt: r.confirmed_at,
  }));
}
