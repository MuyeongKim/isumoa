import type { Kysely } from 'kysely';
import type {
  CertificateDetail,
  CertificateFlag,
  CertificateListItem,
  CertificateStatus,
  EmployeeRef,
  SessionUser,
  Training,
} from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { toTraining } from '../routes/trainings.ts';
import { matchEmployee, type MatchableEmployee } from './employeeMatcher.ts';
import { computeFlags, withNotes } from './flags.ts';
import { hasUsableText, parseCertificateText } from './parseText.ts';
import { applicableTrainings } from './status.ts';
import { classifyTrainings, trainingScopeConflict, unieduCertificateFlags, type ClassifiableTraining } from './trainingClassifier.ts';

// 이수증 검수에 필요한 DB 읽기·쓰기 모음 (처리 대기열과 검수 API가 함께 쓴다)

export async function loadMatchables(db: Kysely<DB>): Promise<MatchableEmployee[]> {
  const rows = await db
    .selectFrom('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select(['e.id', 'e.name', 'e.name_key', 'e.emp_no', 'e.department_id', 'd.name as department_name', 'e.birth_date', 'e.status'])
    .where('e.deleted_at', 'is', null)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameKey: r.name_key,
    empNo: r.emp_no,
    departmentId: r.department_id,
    departmentName: r.department_name,
    birthDate: r.birth_date,
    status: r.status,
  }));
}

export async function loadTrainings(db: Kysely<DB>): Promise<Training[]> {
  const rows = await db.selectFrom('trainings').selectAll().where('deleted_at', 'is', null).orderBy('sort_order').orderBy('id').execute();
  return rows.map(toTraining);
}

export function classifiable(trainings: Training[], year: number): ClassifiableTraining[] {
  const applicable = new Set(applicableTrainings(trainings, year).map((t) => t.id));
  return trainings.map((t) => ({ id: t.id, code: t.code, name: t.name, keywords: t.keywords, applicable: applicable.has(t.id) }));
}

export async function loadLearned(db: Kysely<DB>): Promise<Map<string, number[]>> {
  const rows = await db.selectFrom('course_mappings').select(['title_key', 'training_id']).execute();
  const map = new Map<string, number[]>();
  for (const r of rows) map.set(r.title_key, [...(map.get(r.title_key) ?? []), r.training_id]);
  return map;
}

/** 이 사용자가 다룰 수 있는 부서. 관리자는 전체라 null */
export async function scopeOfUser(db: Kysely<DB>, userId: number): Promise<number[] | null> {
  const user = await db.selectFrom('users').select('role').where('id', '=', userId).executeTakeFirst();
  if (!user || user.role === 'admin') return null;
  const rows = await db.selectFrom('user_departments').innerJoin('departments as d', 'd.id', 'user_departments.department_id').select('department_id').where('user_id', '=', userId).where('d.deleted_at', 'is', null).execute();
  return rows.map((r) => r.department_id);
}

export function scopeOf(user: SessionUser): number[] | null {
  return user.role === 'admin' ? null : user.departments.map((d) => d.id);
}

/** 원본 쪽을 (다시) 읽는 중인지 */
export function isReading(pageState: string): boolean {
  return pageState === 'queued' || pageState === 'processing';
}

/** 쪽의 글자: PDF 글자층이 쓸 만하면 그것, 아니면 OCR 결과 */
export function pageText(page: { text_layer: string | null; ocr_text: string | null }): string {
  return hasUsableText(page.text_layer) ? page.text_layer! : (page.ocr_text ?? page.text_layer ?? '');
}

async function loadCertificateRow(db: Kysely<DB>, id: number) {
  return db
    .selectFrom('certificates as c')
    .innerJoin('pages as p', 'p.id', 'c.page_id')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .innerJoin('batches as b', 'b.id', 'c.batch_id')
    .leftJoin('users as u', 'u.id', 'c.confirmed_by')
    .selectAll('c')
    .select([
      'p.page_no',
      'p.text_layer',
      'p.ocr_text',
      'p.route',
      'p.state as page_state',
      'f.original_name',
      'f.page_count',
      'b.year as batch_year',
      'b.created_by as batch_owner',
      'u.name as confirmed_by_name',
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();
}
export type CertificateRow = NonNullable<Awaited<ReturnType<typeof loadCertificateRow>>>;

export async function getCertificateRow(db: Kysely<DB>, id: number): Promise<CertificateRow | undefined> {
  return loadCertificateRow(db, id);
}

async function creditsOf(db: Kysely<DB>, certificateIds: number[]) {
  if (certificateIds.length === 0) return [];
  return db
    .selectFrom('certificate_trainings')
    .select(['certificate_id', 'training_id', 'credited_hours'])
    .where('certificate_id', 'in', certificateIds)
    .execute();
}

/** 지금 값으로 "확인할 점"을 계산한다 (저장은 하지 않음) */
export async function evaluateFlags(db: Kysely<DB>, row: CertificateRow, scope: number[] | null): Promise<CertificateFlag[]> {
  const trainings = await loadTrainings(db);
  const credits = await creditsOf(db, [row.id]);
  const selected = trainings.filter((t) => credits.some((c) => c.training_id === t.id));
  const text = pageText(row);
  const parsed = parseCertificateText(text);

  const employee = row.employee_id
    ? await db
        .selectFrom('employees as e')
        .leftJoin('departments as d', 'd.id', 'e.department_id')
        .select(['e.name', 'e.department_id', 'd.name as department_name', 'e.birth_date', 'e.status'])
        .where('e.id', '=', row.employee_id)
        .where('e.deleted_at', 'is', null)
        .executeTakeFirst()
    : undefined;

  let ambiguousCount = 0;
  if (!employee) {
    const match = matchEmployee({ name: row.person_name, birth: row.person_birth, dept: row.person_dept, text }, await loadMatchables(db), scope);
    ambiguousCount = match.candidates.length;
  }

  const year = row.year ?? row.batch_year;
  const classificationContext = { provider: row.provider ?? parsed.provider,
    year: row.completed_on ? Number(row.completed_on.slice(0, 4)) : year, fullText: text, hours: row.hours };
  const inactiveMatches =
    selected.length === 0
      ? classifyTrainings(row.course_title, text, classifiable(trainings, year), new Map(), classificationContext).inactiveMatches
      : [];

  let duplicateIds: number[] = [];
  let alreadyConfirmedDuplicate: number | null = null;
  if (row.employee_id && ((row.completed_on && selected.length > 0) || (row.cert_no && row.provider))) {
    const dupes = await db
      .selectFrom('certificates as c')
      .select(['c.id', 'c.status', 'c.cert_no', 'c.provider', 'c.completed_on', 'c.course_title'])
      .where('c.id', '!=', row.id)
      .where('c.status', '!=', 'excluded')
      .where('c.employee_id', '=', row.employee_id)
      .where(eb => eb.or([
        ...(row.completed_on && selected.length ? [eb.and([
          eb('c.completed_on', '=', row.completed_on),
          eb.exists(eb.selectFrom('certificate_trainings as ct').select('ct.certificate_id')
            .whereRef('ct.certificate_id', '=', 'c.id').where('ct.training_id', 'in', selected.map(t => t.id))),
        ])] : []),
        ...(row.cert_no && row.provider ? [eb.and([eb('c.cert_no', '=', row.cert_no), eb('c.provider', '=', row.provider)])] : []),
      ]))
      .execute();
    duplicateIds = dupes.map((d) => d.id);
    const sameText = (a: string, b: string) => a.normalize('NFC').replace(/\s/g, '').toLowerCase() === b.normalize('NFC').replace(/\s/g, '').toLowerCase();
    if (row.status === 'draft' && row.cert_no && row.provider && row.completed_on && row.course_title) {
      alreadyConfirmedDuplicate = dupes.find(d => d.status === 'confirmed' && d.cert_no === row.cert_no && d.provider === row.provider &&
        d.completed_on === row.completed_on && d.course_title && sameText(d.course_title, row.course_title!))?.id ?? null;
    }
  }

  const flags = computeFlags({
    status: row.status,
    personName: row.person_name,
    personBirth: row.person_birth,
    personDept: row.person_dept,
    employee: employee
      ? {
          name: employee.name,
          departmentId: employee.department_id,
          departmentName: employee.department_name,
          birthDate: employee.birth_date,
          status: employee.status,
        }
      : null,
    ambiguousCount,
    trainings: selected.map((t) => ({ name: t.name, reqType: t.reqType })),
    inactiveMatches,
    completedOn: row.completed_on,
    hours: row.hours,
    hoursText: row.hours_text,
    batchYear: row.batch_year,
    year: row.year,
    looksLikeCertificate: parsed.looksLikeCertificate,
    route: row.route,
    duplicateIds,
    scope,
    today: new Date().toISOString().slice(0, 10),
  });
  if (alreadyConfirmedDuplicate !== null) flags.push({ code: 'duplicate-confirmed', level: 'error', message: `같은 직원·기관·증서번호·이수일·과정의 수료증 #${alreadyConfirmedDuplicate}가 이미 확정되어 있습니다. 이 재발급본은 중복 제출로 제외해 주세요.` });
  // 과정명을 비운 경우에도 원본에서 읽은 주제를 확인한다. 실제 판독 오류는 과정명을 올바르게 고쳐 해결할 수 있다.
  const checkedTitle = row.course_title ?? parsed.courseTitle;
  const conflicts = selected.map(t => trainingScopeConflict(checkedTitle, t, classificationContext)).filter((message): message is string => message !== null);
  if (conflicts.length) flags.push({ code: 'training-scope-conflict', level: 'error', message: `${conflicts.join(' ')} 인정할 교육 또는 과정명을 바로잡아 주제 충돌을 해결한 뒤 확정해 주세요.` });
  flags.push(...unieduCertificateFlags(checkedTitle, classificationContext));
  if (credits.some(c => !trainings.some(t => t.id === c.training_id))) {
    flags.push({ code: 'deleted-training', level: 'error', message: '삭제된 교육이 연결되어 있습니다. 교육을 복원하거나 인정 교육을 다시 골라 주세요.' });
  }
  // 인식할 때 남긴 확인할 점은 서무가 값을 고치기 전까지만 보인다
  return row.source === 'manual' ? flags : withNotes(flags, JSON.parse(row.notes) as CertificateFlag[]);
}

/** 계산한 "확인할 점"을 저장한다 (목록에서 바로 보이도록) */
export async function refreshFlags(db: Kysely<DB>, id: number, scope: number[] | null): Promise<CertificateFlag[]> {
  const row = await loadCertificateRow(db, id);
  if (!row) return [];
  const flags = await evaluateFlags(db, row, scope);
  await db.updateTable('certificates').set({ flags: JSON.stringify(flags) }).where('id', '=', id).execute();
  return flags;
}

function employeeRef(
  e: { id: number; name: string; emp_no: string | null; department_name: string | null; birth_date: string | null; department_id: number | null },
  scope: number[] | null,
): EmployeeRef {
  // 서무에게는 담당 부서가 아닌 직원의 생년월일을 보여 주지 않는다
  const visible = scope === null || (e.department_id !== null && scope.includes(e.department_id));
  return { id: e.id, name: e.name, empNo: e.emp_no, departmentName: e.department_name, birthDate: visible ? e.birth_date : null };
}

export interface ListFilter {
  status?: CertificateStatus;
  batchId?: number;
  employeeId?: number;
  trainingId?: number;
  year?: number;
}

/** 검수함 목록. 서무는 자기가 올린 묶음과 담당 부서 직원의 이수증만 본다 */
export async function listCertificates(db: Kysely<DB>, filter: ListFilter, viewer: SessionUser): Promise<CertificateListItem[]> {
  const scope = scopeOf(viewer);
  const rows = await db
    .selectFrom('certificates as c')
    .innerJoin('pages as p', 'p.id', 'c.page_id')
    .innerJoin('files as f', 'f.id', 'p.file_id')
    .innerJoin('batches as b', 'b.id', 'c.batch_id')
    .leftJoin('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select([
      'c.id',
      'c.batch_id',
      'c.page_id',
      'c.status',
      'c.person_name',
      'c.course_title',
      'c.employee_id',
      'c.completed_on',
      'c.hours',
      'c.flags',
      'p.page_no',
      'p.route',
      'p.state as page_state',
      'f.original_name',
      'f.page_count',
      'e.name as employee_name',
      'e.emp_no',
      'e.birth_date',
      'e.department_id',
      'd.name as department_name',
    ])
    .$if(scope !== null, (qb) =>
      qb.where((eb) =>
        eb.or([eb('b.created_by', '=', viewer.id), ...(scope!.length ? [eb('e.department_id', 'in', scope!)] : [])]),
      ),
    )
    .$if(filter.status !== undefined, (qb) => qb.where('c.status', '=', filter.status!))
    .$if(filter.batchId !== undefined, (qb) => qb.where('c.batch_id', '=', filter.batchId!))
    .$if(filter.employeeId !== undefined, (qb) => qb.where('c.employee_id', '=', filter.employeeId!))
    .$if(filter.year !== undefined, (qb) => qb.where('c.year', '=', filter.year!))
    .$if(filter.trainingId !== undefined, (qb) =>
      qb.where('c.id', 'in', (eb) =>
        eb.selectFrom('certificate_trainings').select('certificate_id').where('training_id', '=', filter.trainingId!),
      ),
    )
    .orderBy('c.batch_id', 'desc')
    .orderBy('f.id')
    .orderBy('p.page_no')
    .execute();

  const credits = await creditsOf(db, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    pageId: r.page_id,
    fileName: r.original_name,
    pageNo: r.page_no,
    pageCount: r.page_count,
    status: r.status,
    personName: r.person_name,
    courseTitle: r.course_title,
    employee:
      r.employee_id && r.employee_name
        ? employeeRef(
            { id: r.employee_id, name: r.employee_name, emp_no: r.emp_no, department_name: r.department_name, birth_date: r.birth_date, department_id: r.department_id },
            scope,
          )
        : null,
    trainingIds: credits.filter((c) => c.certificate_id === r.id).map((c) => c.training_id),
    completedOn: r.completed_on,
    hours: r.hours,
    flags: JSON.parse(r.flags) as CertificateFlag[],
    route: r.route,
    reading: isReading(r.page_state),
  }));
}

export async function canViewCertificate(db: Kysely<DB>, row: CertificateRow, viewer: SessionUser): Promise<boolean> {
  const scope = scopeOf(viewer);
  if (scope === null || row.batch_owner === viewer.id) return true;
  if (!row.employee_id) return false;
  const e = await db.selectFrom('employees').select('department_id').where('id', '=', row.employee_id).executeTakeFirst();
  return e?.department_id != null && scope.includes(e.department_id);
}

export async function getCertificateDetail(db: Kysely<DB>, row: CertificateRow, viewer: SessionUser): Promise<CertificateDetail> {
  const scope = scopeOf(viewer);
  const employees = await loadMatchables(db);
  const employee = employees.find((e) => e.id === row.employee_id);
  const match = matchEmployee({ name: row.person_name, birth: row.person_birth, dept: row.person_dept, text: pageText(row) }, employees, scope);
  const credits = await creditsOf(db, [row.id]);
  const flags = row.status === 'draft' ? await evaluateFlags(db, row, scope) : (JSON.parse(row.flags) as CertificateFlag[]);
  const hideBirth = (departmentId: number | null) => scope !== null && (departmentId === null || !scope.includes(departmentId));

  return {
    id: row.id,
    batchId: row.batch_id,
    pageId: row.page_id,
    fileName: row.original_name,
    pageNo: row.page_no,
    pageCount: row.page_count,
    status: row.status,
    personName: row.person_name,
    employee: employee
      ? employeeRef(
          { id: employee.id, name: employee.name, emp_no: employee.empNo, department_name: employee.departmentName, birth_date: employee.birthDate, department_id: employee.departmentId },
          scope,
        )
      : null,
    trainingIds: credits.map((c) => c.training_id),
    completedOn: row.completed_on,
    hours: row.hours,
    flags,
    route: row.route,
    reading: isReading(row.page_state),
    personBirth: row.person_birth,
    personDept: row.person_dept,
    courseTitle: row.course_title,
    provider: row.provider,
    certNo: row.cert_no,
    hoursText: row.hours_text,
    year: row.year,
    batchYear: row.batch_year,
    credits: credits.map((c) => ({ trainingId: c.training_id, creditedHours: c.credited_hours })),
    candidates: match.candidates.map((c) => {
      const e = employees.find((x) => x.id === c.id);
      return hideBirth(e?.departmentId ?? null) ? { ...c, birthDate: null } : c;
    }),
    pageText: pageText(row),
    excludeReason: row.exclude_reason,
    confirmedBy: row.confirmed_by_name,
    confirmedAt: row.confirmed_at,
  };
}
