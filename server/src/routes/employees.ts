import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import {
  EMPLOYEE_STATUSES,
  ROSTER_FIELDS,
  type Employee,
  type RosterApplyResult,
  type RosterParseResult,
  type RosterPreview,
} from '../../../shared/types.ts';
import { assertDepartmentInScope, currentUser, departmentScope, requireAdmin, requireUser } from '../auth/guard.ts';
import type { DB } from '../db/schema.ts';
import { nowIso } from '../db/sqlite.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { formatLocalDate, parseDateLoose } from '../lib/dates.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { nameKey } from '../lib/text.ts';
import { autoMapColumns, detectHeaderRow } from '../../../shared/rosterColumns.ts';
import { deleteImport, getImport, saveImport } from '../roster/importStore.ts';
import { buildRosterPreview, type ExistingEmployee } from '../roster/preview.ts';
import { readRosterFile, RosterFileError } from '../roster/readRosterFile.ts';
import { toRecords } from '../roster/records.ts';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** 날짜 칸: 비우면 null, 형식이 틀리면 오류 */
const optionalDate = (label: string) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      if (value === null || value.trim() === '') return null;
      const parsed = parseDateLoose(value).value;
      if (!parsed) {
        ctx.addIssue({ code: 'custom', message: `${label} 형식을 확인해 주세요 (예: 1985-03-12).` });
        return z.NEVER;
      }
      return parsed;
    });

const EmployeeFields = z.object({
  empNo: optionalText(30),
  name: z.string().trim().min(1, '성명을 입력해 주세요.').max(50),
  departmentId: z.number().int().positive('부서를 골라 주세요.'),
  position: optionalText(50),
  empType: optionalText(50),
  birthDate: optionalDate('생년월일'),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  hiredOn: optionalDate('임용일'),
  leftOn: optionalDate('퇴직일'),
  note: optionalText(500),
});
const CreateEmployeeBody = EmployeeFields;
const UpdateEmployeeBody = EmployeeFields.partial();

const ListQuery = z.object({
  q: z.string().trim().max(50).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
});

const IdParams = z.object({ id: z.coerce.number().int().positive() });

const ImportOptionsBody = z.object({
  importId: z.string().uuid(),
  sheetIndex: z.number().int().min(0),
  headerRowIndex: z.number().int().min(0),
  mapping: z.object(
    Object.fromEntries(ROSTER_FIELDS.map((f) => [f.key, z.number().int().min(0).nullable()])) as Record<
      (typeof ROSTER_FIELDS)[number]['key'],
      z.ZodNullable<z.ZodNumber>
    >,
  ),
  retireMissing: z.boolean().default(false),
});

async function loadExisting(db: Kysely<DB>): Promise<ExistingEmployee[]> {
  const rows = await db
    .selectFrom('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .select([
      'e.id',
      'e.emp_no',
      'e.name',
      'e.name_key',
      'd.name as department_name',
      'e.position',
      'e.emp_type',
      'e.birth_date',
      'e.status',
      'e.hired_on',
      'e.left_on',
    ])
    .execute();
  return rows.map((r) => ({
    id: r.id,
    empNo: r.emp_no,
    name: r.name,
    nameKey: r.name_key,
    departmentName: r.department_name,
    position: r.position,
    empType: r.emp_type,
    birthDate: r.birth_date,
    status: r.status,
    hiredOn: r.hired_on,
    leftOn: r.left_on,
  }));
}

export async function employeeRoutes(app: FastifyInstance, { db }: Deps) {
  async function assertUniqueEmpNo(empNo: string | null | undefined, exceptId?: number) {
    if (!empNo) return;
    const same = await db
      .selectFrom('employees')
      .select('id')
      .where('emp_no', '=', empNo)
      .$if(exceptId !== undefined, (qb) => qb.where('id', '!=', exceptId!))
      .executeTakeFirst();
    if (same) throw new HttpError(409, `사번 ${empNo}은(는) 이미 다른 직원이 쓰고 있습니다.`);
  }

  async function assertDepartmentExists(id: number) {
    const found = await db.selectFrom('departments').select('id').where('id', '=', id).executeTakeFirst();
    if (!found) throw badRequest('없는 부서입니다.');
  }

  app.get('/api/employees', { preHandler: requireUser }, async (req): Promise<Employee[]> => {
    const query = ListQuery.parse(req.query);
    const scope = departmentScope(currentUser(req));
    if (scope && scope.length === 0) return [];
    const keyword = query.q ? nameKey(query.q) : '';

    const rows = await db
      .selectFrom('employees as e')
      .leftJoin('departments as d', 'd.id', 'e.department_id')
      .selectAll('e')
      .select('d.name as department_name')
      .$if(scope !== null, (qb) => qb.where('e.department_id', 'in', scope!))
      .$if(query.departmentId !== undefined, (qb) => qb.where('e.department_id', '=', query.departmentId!))
      .$if(query.status !== undefined, (qb) => qb.where('e.status', '=', query.status!))
      .$if(keyword !== '', (qb) =>
        qb.where((eb) => eb.or([eb('e.name_key', 'like', `%${keyword}%`), eb('e.emp_no', 'like', `%${keyword}%`)])),
      )
      .orderBy('d.sort_order')
      .orderBy('d.name')
      .orderBy('e.name')
      .execute();

    return rows.map((r) => ({
      id: r.id,
      empNo: r.emp_no,
      name: r.name,
      departmentId: r.department_id,
      departmentName: r.department_name,
      position: r.position,
      empType: r.emp_type,
      birthDate: r.birth_date,
      status: r.status,
      hiredOn: r.hired_on,
      leftOn: r.left_on,
      note: r.note,
    }));
  });

  app.post('/api/employees', { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const body = CreateEmployeeBody.parse(req.body);
    assertDepartmentInScope(user, body.departmentId);
    await assertDepartmentExists(body.departmentId);
    await assertUniqueEmpNo(body.empNo);

    const created = await db
      .insertInto('employees')
      .values({
        emp_no: body.empNo ?? null,
        name: body.name.normalize('NFC'),
        name_key: nameKey(body.name),
        department_id: body.departmentId,
        position: body.position ?? null,
        emp_type: body.empType ?? null,
        birth_date: body.birthDate ?? null,
        status: body.status ?? 'active',
        hired_on: body.hiredOn ?? null,
        left_on: body.leftOn ?? null,
        note: body.note ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(db, req, 'employee.create', { type: 'employee', id: created.id });
    return { id: created.id };
  });

  app.patch('/api/employees/:id', { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const { id } = IdParams.parse(req.params);
    const body = UpdateEmployeeBody.parse(req.body);
    const before = await db.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirst();
    if (!before) throw notFound('직원을 찾을 수 없습니다.');
    assertDepartmentInScope(user, before.department_id);
    if (body.departmentId !== undefined) {
      assertDepartmentInScope(user, body.departmentId);
      await assertDepartmentExists(body.departmentId);
    }
    if (body.empNo !== undefined) await assertUniqueEmpNo(body.empNo, id);

    await db
      .updateTable('employees')
      .set({
        ...(body.empNo !== undefined ? { emp_no: body.empNo } : {}),
        ...(body.name !== undefined ? { name: body.name.normalize('NFC'), name_key: nameKey(body.name) } : {}),
        ...(body.departmentId !== undefined ? { department_id: body.departmentId } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.empType !== undefined ? { emp_type: body.empType } : {}),
        ...(body.birthDate !== undefined ? { birth_date: body.birthDate } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.hiredOn !== undefined ? { hired_on: body.hiredOn } : {}),
        ...(body.leftOn !== undefined ? { left_on: body.leftOn } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
        updated_at: nowIso(),
      })
      .where('id', '=', id)
      .execute();
    // 무엇을 바꿨는지만 남기고 값(개인정보)은 남기지 않는다
    await audit(db, req, 'employee.update', { type: 'employee', id }, { fields: Object.keys(body) });
    return { ok: true };
  });

  // ── 명단 일괄 등록 (관리자) ─────────────────────────────────

  app.post('/api/employees/import/parse', { preHandler: requireAdmin }, async (req): Promise<RosterParseResult> => {
    const user = currentUser(req);
    const file = await req.file();
    if (!file) throw badRequest('파일을 골라 주세요.');
    const fileName = file.filename.normalize('NFC');
    // .xls는 받아서 읽을 수 없는 이유와 .xlsx로 저장하는 방법을 알려 주려고 확장자는 통과시킨다
    if (!/\.(xlsx|xls|csv|txt)$/i.test(fileName)) throw badRequest('엑셀(.xlsx) 또는 CSV 파일만 올릴 수 있습니다.');
    const buffer = await file.toBuffer();

    let sheets;
    try {
      sheets = await readRosterFile(buffer);
    } catch (err) {
      throw badRequest(err instanceof RosterFileError ? err.message : '파일을 읽지 못했습니다. 엑셀에서 다른 이름으로 저장(.xlsx)한 뒤 다시 올려 주세요.');
    }
    const sheetIndex = Math.max(0, sheets.findIndex((s) => s.rows.length > 0));
    const rows = sheets[sheetIndex]?.rows ?? [];
    if (rows.length === 0) throw badRequest('파일에 내용이 없습니다.');

    const headerRowIndex = detectHeaderRow(rows);
    const importId = saveImport(user.id, fileName, sheets);
    return {
      importId,
      fileName,
      sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
      sheetIndex,
      headerRowIndex,
      topRows: rows.slice(0, 15),
      headers: rows[headerRowIndex] ?? [],
      mapping: autoMapColumns(rows[headerRowIndex] ?? []),
    };
  });

  // 시트를 바꿔 고를 때 앞부분과 자동 열 연결을 다시 받는다
  app.post('/api/employees/import/sheet', { preHandler: requireAdmin }, async (req): Promise<RosterParseResult> => {
    const user = currentUser(req);
    const body = z.object({ importId: z.string().uuid(), sheetIndex: z.number().int().min(0) }).parse(req.body);
    const stored = getImport(body.importId, user.id);
    if (!stored) throw badRequest('파일 정보가 만료되었습니다. 파일을 다시 올려 주세요.');
    const rows = stored.sheets[body.sheetIndex]?.rows;
    if (!rows) throw badRequest('시트를 찾을 수 없습니다.');
    const headerRowIndex = detectHeaderRow(rows);
    return {
      importId: body.importId,
      fileName: stored.fileName,
      sheets: stored.sheets.map((s) => ({ name: s.name, rowCount: s.rows.length })),
      sheetIndex: body.sheetIndex,
      headerRowIndex,
      topRows: rows.slice(0, 15),
      headers: rows[headerRowIndex] ?? [],
      mapping: autoMapColumns(rows[headerRowIndex] ?? []),
    };
  });

  async function prepare(userId: number, body: z.infer<typeof ImportOptionsBody>) {
    const stored = getImport(body.importId, userId);
    if (!stored) throw badRequest('파일 정보가 만료되었습니다. 파일을 다시 올려 주세요.');
    const rows = stored.sheets[body.sheetIndex]?.rows;
    if (!rows) throw badRequest('시트를 찾을 수 없습니다.');
    if (body.mapping.name === null || body.mapping.department === null) {
      throw badRequest('성명과 부서 열은 꼭 지정해야 합니다.');
    }
    const records = toRecords(rows, body.headerRowIndex, body.mapping);
    const departments = await db.selectFrom('departments').select(['id', 'name']).execute();
    const existing = await loadExisting(db);
    const result = buildRosterPreview(
      records,
      existing,
      departments.map((d) => d.name),
      body.mapping,
      body.retireMissing,
    );
    return { ...result, stored, departments };
  }

  app.post('/api/employees/import/preview', { preHandler: requireAdmin }, async (req): Promise<RosterPreview> => {
    const body = ImportOptionsBody.parse(req.body);
    const { preview } = await prepare(currentUser(req).id, body);
    return preview;
  });

  app.post('/api/employees/import/apply', { preHandler: requireAdmin }, async (req): Promise<RosterApplyResult> => {
    const body = ImportOptionsBody.parse(req.body);
    const { plan, stored, departments } = await prepare(currentUser(req).id, body);
    const today = formatLocalDate(new Date());

    await db.transaction().execute(async (trx) => {
      const departmentIds = new Map(departments.map((d) => [d.name, d.id]));
      const maxOrder = await trx
        .selectFrom('departments')
        .select((eb) => eb.fn.max('sort_order').as('max'))
        .executeTakeFirst();
      let order = Number(maxOrder?.max ?? 0);
      for (const name of plan.newDepartments) {
        order += 10;
        const created = await trx
          .insertInto('departments')
          .values({ name, sort_order: order })
          .returning('id')
          .executeTakeFirstOrThrow();
        departmentIds.set(name, created.id);
      }

      for (const r of plan.creates) {
        await trx
          .insertInto('employees')
          .values({
            emp_no: r.empNo,
            name: r.name,
            name_key: r.nameKey,
            department_id: departmentIds.get(r.departmentName) ?? null,
            position: r.position,
            emp_type: r.empType,
            birth_date: r.birthDate,
            status: r.status ?? 'active',
            hired_on: r.hiredOn,
            left_on: r.leftOn,
          })
          .execute();
      }

      for (const { employeeId, record: r, changes } of plan.updates) {
        const changed = new Set(changes.map((c) => c.field));
        await trx
          .updateTable('employees')
          .set({
            ...(changed.has('empNo') ? { emp_no: r.empNo } : {}),
            ...(changed.has('name') ? { name: r.name, name_key: r.nameKey } : {}),
            ...(changed.has('department') ? { department_id: departmentIds.get(r.departmentName) ?? null } : {}),
            ...(changed.has('position') ? { position: r.position } : {}),
            ...(changed.has('empType') ? { emp_type: r.empType } : {}),
            ...(changed.has('birthDate') ? { birth_date: r.birthDate } : {}),
            ...(changed.has('status') && r.status ? { status: r.status } : {}),
            ...(changed.has('hiredOn') ? { hired_on: r.hiredOn } : {}),
            ...(changed.has('leftOn') ? { left_on: r.leftOn } : {}),
            updated_at: nowIso(),
          })
          .where('id', '=', employeeId)
          .execute();
      }

      for (const id of plan.retireIds) {
        await trx
          .updateTable('employees')
          .set((eb) => ({ status: 'retired', left_on: eb.fn.coalesce('left_on', eb.val(today)), updated_at: nowIso() }))
          .where('id', '=', id)
          .execute();
      }
    });

    const result: RosterApplyResult = {
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged,
      retired: plan.retireIds.length,
      skipped: plan.skipped,
      departmentsCreated: plan.newDepartments.length,
    };
    await audit(db, req, 'employee.import', { type: 'roster', id: stored.fileName }, { ...result });
    deleteImport(body.importId);
    return result;
  });
}

