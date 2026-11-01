import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { BulkExcludePreview, BulkExcludeResult, SessionUser } from '../../../shared/types.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { canViewCertificate, evaluateFlags, getCertificateRow, isReading, scopeOf } from './review.ts';

async function selection(db: Kysely<DB>, user: SessionUser, requested: number[], onlyNonCertificates=false) {
  const ids = [...new Set(requested)].sort((a, b) => a - b);
  if (!ids.length || ids.length > 500) throw badRequest('수료증을 1~500건 선택해 주세요.');
  const rows = [];
  for (const id of ids) {
    const row = await getCertificateRow(db, id);
    if (!row) throw notFound('선택한 수료증 중 찾을 수 없는 자료가 있습니다. 목록을 다시 확인해 주세요.');
    if (!(await canViewCertificate(db, row, user))) throw new HttpError(403, '선택한 수료증 중 제외할 권한이 없는 자료가 있습니다.');
    if (row.status === 'excluded') throw new HttpError(409, '이미 제외한 자료가 포함되어 있습니다. 목록을 다시 확인해 주세요.');
    if (isReading(row.page_state)) throw new HttpError(409, '다시 읽는 중인 수료증은 판독이 끝난 뒤 제외해 주세요.');
    if(onlyNonCertificates){
      const scope=scopeOf(user);
      if(scope!==null&&row.employee_id){const employee=await db.selectFrom('employees').select('department_id').where('id','=',row.employee_id).executeTakeFirst();if(employee?.department_id==null||!scope.includes(employee.department_id))throw new HttpError(403,'담당 부서 밖 자료는 한 번에 제외할 수 없습니다.');}
      if(row.status!=='draft'||!(await evaluateFlags(db,row,scope)).some(f=>f.code==='not-certificate'))throw new HttpError(409,'현재 검수 대기 중인 이수증 아닌 쪽만 제외할 수 있습니다. 목록을 다시 확인해 주세요.');
    }
    rows.push(row);
  }
  const credits = await db.selectFrom('certificate_trainings').selectAll().where('certificate_id', 'in', ids).orderBy('certificate_id').orderBy('training_id').execute();
  const token = createHash('sha256').update(JSON.stringify({ user: user.id, onlyNonCertificates, rows, credits })).digest('hex');
  return { ids, rows, token };
}

export async function previewBulkExclude(db: Kysely<DB>, user: SessionUser, ids: number[], onlyNonCertificates=false): Promise<BulkExcludePreview> {
  const selected = await selection(db, user, ids, onlyNonCertificates);
  const employeeIds = [...new Set(selected.rows.flatMap(row => row.employee_id ? [row.employee_id] : []))];
  const employees = employeeIds.length ? await db.selectFrom('employees').select(['id', 'name']).where('id', 'in', employeeIds).execute() : [];
  const names = new Map(employees.map(e => [e.id, e.name]));
  return { ids: selected.ids, drafts: selected.rows.filter(r => r.status === 'draft').length,
    confirmed: selected.rows.filter(r => r.status === 'confirmed').length, token: selected.token,
    items: selected.rows.map(r => ({ id: r.id, status: r.status, employeeName: names.get(r.employee_id ?? 0) ?? r.person_name,
      fileName: r.original_name, courseTitle: r.course_title })) };
}

/** 대상과 권한을 다시 확인하고 모두 함께 제외한다. 원본·인정 연결·과거 확정 정보는 그대로 둔다. */
export async function bulkExclude(db: Kysely<DB>, user: SessionUser, ids: number[], token: string, reason: string, onlyNonCertificates=false) {
  return db.transaction().execute(async trx => {
    const current = await selection(trx, user, ids, onlyNonCertificates);
    if (current.token !== token) throw new HttpError(409, '선택한 자료가 확인창을 연 뒤 바뀌었습니다. 최신 목록을 확인한 뒤 다시 선택해 주세요.');
    if(onlyNonCertificates)reason='이수증 아님';
    await trx.updateTable('certificates').set({ status: 'excluded', exclude_reason: reason, updated_at: nowIso() }).where('id', 'in', current.ids).execute();
    const result: BulkExcludeResult = { excluded: current.ids.length, ids: current.ids };
    return { result, previous: current.rows.map(r => ({ id: r.id, status: r.status })) };
  });
}
