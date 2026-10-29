import { loadWorkbook } from '../forms/analyze.ts';
import { isStatutoryTemplate } from '../forms/statutoryTemplate.ts';
import { ZipArchive } from 'archiver';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZIP_LAYOUTS, type ExportSummary, type FormMarkStyle } from '../../../shared/types.ts';
import { DEFAULT_PERSONAL_TITLE, PERSONAL_TITLE_FIELDS, DEFAULT_CERTIFICATE_TITLE, certificateTitleError } from '../../../shared/exportTitles.ts';
import { assertDepartmentInScope, currentUser, departmentScope, requireUser } from '../auth/guard.ts';
import { getSetting } from '../db/seed.ts';
import type { Deps } from '../deps.ts';
import { fillForm } from '../forms/fill.ts';
import { loadFormPeople, type FormPersonRow } from '../forms/people.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { buildStatusWorkbook } from '../reports/excel.ts';
import { buildEvidenceZip, buildMergedPdf, buildPersonalZip } from '../reports/evidence.ts';
import { checkFinalExport, buildStatutoryWorkbook } from '../reports/statutory.ts';
import { HttpError } from '../lib/errors.ts';
import { safeName } from '../reports/fileNames.ts';
import { loadRecords } from '../reports/records.ts';
import { loadStatusReport } from '../reports/statusReport.ts';
import { canUseForm, getForm } from './forms.ts';
import { countDrafts } from './status.ts';

// 내보내기: 이수 현황 엑셀, 이수증 ZIP, 교육별 합본 PDF.
// 서무는 담당 부서 직원 것만 받는다. 받은 기록은 감사 로그에 남긴다.

const ExportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  departmentId: z.coerce.number().int().positive().optional(),
});
// 개인정보가 든 자료를 내려받을 때는 사유를 받는다 (접속기록 월 점검 때 확인)
const DownloadQuery = ExportQuery.extend({
  reason: z.string({ error: '내려받는 사유를 골라 주세요.' }).trim().min(2, '내려받는 사유를 골라 주세요.').max(100),
});
const ZipQuery = DownloadQuery.extend({
  layout: z.enum(ZIP_LAYOUTS).default('training'),
  title: z.string().trim().max(150).default(DEFAULT_CERTIFICATE_TITLE).refine(v => !certificateTitleError(v), '수료증 파일명 규칙을 확인해 주세요.'),
  archiveTitle: z.string().trim().min(1).max(100).optional(),
  trainingId: z.coerce.number().int().positive().optional(),
});
const PdfQuery = DownloadQuery.extend({ trainingId: z.coerce.number().int().positive() });
const PersonalQuery = DownloadQuery.extend({
  title: z.string().trim().min(1).max(150).default(DEFAULT_PERSONAL_TITLE).refine(value =>
    [...value.matchAll(/\{([^{}]+)\}/g)].every(m => PERSONAL_TITLE_FIELDS.some(key => key === m[1])), '제목에는 {연도}, {부서}, {성명}, {사번}만 사용할 수 있습니다.'),
  archiveTitle: z.string().trim().min(1).max(100).optional(),
  employeeId: z.coerce.number().int().positive().optional(),
});
const flag = z
  .enum(['0', '1'])
  .optional()
  .transform((v) => v === '1');
const FormQuery = DownloadQuery.extend({ formId: z.coerce.number().int().positive(), onlyMissing: flag, split: flag });

function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('-', '');
}

/** 양식의 {작성일}: "2026. 10. 23." */
function todayKorean(): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** 부서별로 나눈다 (순서 유지) */
function byDepartment(people: FormPersonRow[]): FormPersonRow[][] {
  const groups = new Map<number | null, FormPersonRow[]>();
  for (const p of people) groups.set(p.departmentId, [...(groups.get(p.departmentId) ?? []), p]);
  return [...groups.values()];
}

export async function exportRoutes(app: FastifyInstance, { db, config }: Deps) {
  /** 요청한 범위를 확인하고, 파일 이름·제목에 쓸 범위 이름을 돌려준다 */
  async function resolveScope(req: FastifyRequest, departmentId: number | undefined) {
    const user = currentUser(req);
    const scope = departmentScope(user);
    if (departmentId !== undefined) assertDepartmentInScope(user, departmentId);
    const department = departmentId
      ? await db.selectFrom('departments').select('name').where('id', '=', departmentId).where('deleted_at', 'is', null).executeTakeFirst()
      : undefined;
    if (departmentId && !department) throw notFound('부서를 찾을 수 없습니다.');
    const label = department ? department.name : scope === null ? '전체 부서' : `담당 부서(${user.departments.map((d) => d.name).join(', ') || '없음'})`;
    return { user, scope, label, filePart: department ? `_${safeName(department.name)}` : '' };
  }

  app.get('/api/exports/statutory/check', { preHandler: requireUser }, async req => {
    const { year, departmentId } = ExportQuery.parse(req.query);
    const { user, scope } = await resolveScope(req, departmentId);
    return checkFinalExport(db, { year, scope, departmentId }, await countDrafts(db, user, year, departmentId));
  });
  app.get('/api/exports/statutory.xlsx', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, reason } = DownloadQuery.parse(req.query);
    const { user, scope, label, filePart } = await resolveScope(req, departmentId);
    const check = await checkFinalExport(db, { year, scope, departmentId }, await countDrafts(db, user, year, departmentId));
    if (!check.ready) throw new HttpError(409, `최종 제출 기준이 충족되지 않았습니다. 교육 기준 누락 ${check.missingTrainings.length}개, 미충족 ${check.blockers.length}항목, 검수 대기 ${check.drafts}건을 먼저 확인해 주세요.`);
    const file = await buildStatutoryWorkbook(db, { year, scope, departmentId });
    await audit(db, req, 'export.form', undefined, { year, scope: label, form: '법정 의무교육 수료자 명단 16시트', employees: check.employees, reason });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', contentDisposition(`${year}년_법정의무교육_수료자명단${filePart}.xlsx`, 'statutory.xlsx'));
    return reply.send(file);
  });

  // 내보내기 화면: 범위 안의 확정 이수증 수와 교육별 수
  app.get('/api/exports/summary', { preHandler: requireUser }, async (req): Promise<ExportSummary> => {
    const { year, departmentId } = ExportQuery.parse(req.query);
    const { user, scope } = await resolveScope(req, departmentId);
    const records = await loadRecords(db, { year, scope, departmentId });
    const report = await loadStatusReport(db, { year, scope, departmentId });
    const employees = new Map<number, ExportSummary['employees'][number]>();
    for (const record of records) {
      if (employees.has(record.employeeId)) continue;
      employees.set(record.employeeId, { employeeId: record.employeeId, name: record.employeeName, empNo: record.empNo, departmentName: record.departmentName,
        certificates: new Set(records.filter(r => r.employeeId === record.employeeId).map(r => r.certificateId)).size });
    }
    return {
      year,
      certificates: new Set(records.map((r) => r.certificateId)).size,
      drafts: await countDrafts(db, user, year, departmentId),
      trainings: report.trainings.map((t) => ({
        trainingId: t.id,
        name: t.name,
        certificates: records.filter((r) => r.trainingId === t.id).length,
      })),
      employees: [...employees.values()],
    };
  });

  app.get('/api/exports/status.xlsx', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, reason } = DownloadQuery.parse(req.query);
    const { user, scope, label, filePart } = await resolveScope(req, departmentId);
    const report = await loadStatusReport(db, { year, scope, departmentId });
    const records = await loadRecords(db, { year, scope, departmentId });
    const org = await getSetting(db, 'org', { name: '' });
    const buffer = await buildStatusWorkbook({
      orgName: org.name,
      year,
      scopeLabel: label,
      createdBy: user.name,
      drafts: await countDrafts(db, user, year, departmentId),
      report,
      records,
    });
    await audit(db, req, 'export.excel', undefined, { year, scope: label, employees: report.rows.length, certificates: records.length, reason });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', contentDisposition(`${year}년_법정교육_이수현황${filePart}_${today()}.xlsx`, 'status.xlsx'));
    return reply.send(buffer);
  });

  app.get('/api/exports/certificates.zip', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, layout, trainingId, reason, title, archiveTitle } = ZipQuery.parse(req.query);
    const { scope, label, filePart } = await resolveScope(req, departmentId);
    const records = await loadRecords(db, { year, scope, departmentId, trainingId });
    if (records.length === 0) throw badRequest('내보낼 확정 이수증이 없습니다.');
    const trainingPart = trainingId ? `_${safeName(records[0].trainingName)}` : '';
    await audit(db, req, 'export.zip', undefined, { year, scope: label, layout, trainingId: trainingId ?? null, files: records.length, title, archiveTitle, reason });
    reply.header('Content-Type', 'application/zip');
    reply.header(
      'Content-Disposition',
      contentDisposition(`${archiveTitle ? safeName(archiveTitle.replace(/\.zip$/i, '')) : `${year}년_이수증_${layout === 'training' ? '교육별' : layout === 'employee' ? '개인별' : '부서별'}${filePart}${trainingPart}`}.zip`, 'certificates.zip'),
    );
    return reply.send(buildEvidenceZip(records, layout, config.dataDir, title, year));
  });

  app.get('/api/exports/employees.zip', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, employeeId, reason, title, archiveTitle } = PersonalQuery.parse(req.query);
    const { scope, label, filePart } = await resolveScope(req, departmentId);
    const all = await loadRecords(db, { year, scope, departmentId });
    const records = employeeId ? all.filter(r => r.employeeId === employeeId) : all;
    if (!records.length) throw badRequest('선택한 범위에 내보낼 확정 이수증이 없습니다.');
    await audit(db, req, 'export.personal-pdf', undefined, { year, scope: label, employees: new Set(records.map(r => r.employeeId)).size, title, reason });
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', contentDisposition(`${safeName(archiveTitle ?? `${year}년_개인별_이수증${filePart}`)}.zip`, 'employees.zip'));
    return reply.send(buildPersonalZip(records, title, year, config.dataDir));
  });

  app.get('/api/exports/merged.pdf', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, trainingId, reason } = PdfQuery.parse(req.query);
    const { scope, label, filePart } = await resolveScope(req, departmentId);
    const records = await loadRecords(db, { year, scope, departmentId, trainingId });
    if (records.length === 0) throw badRequest('합칠 확정 이수증이 없습니다.');
    const training = records[0].trainingName;
    const pdf = await buildMergedPdf(records, `${year}년 ${training} 이수증 합본 (${label})`, config.dataDir);
    await audit(db, req, 'export.pdf', undefined, { year, scope: label, training, certificates: new Set(records.map((r) => r.certificateId)).size, reason });
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', contentDisposition(`${year}년_${safeName(training)}_이수증합본${filePart}.pdf`, 'merged.pdf'));
    return reply.send(Buffer.from(pdf));
  });

  // 제출 양식에 채워 받기: 한 파일, 또는 (전체 부서일 때) 부서별 파일을 ZIP으로
  app.get('/api/exports/form', { preHandler: requireUser }, async (req, reply) => {
    const { year, departmentId, reason, formId, onlyMissing, split } = FormQuery.parse(req.query);
    const { user, scope, label, filePart } = await resolveScope(req, departmentId);
    const form = await getForm(db, formId);
    if (!form || !canUseForm(user, form.department_id)) throw notFound('양식을 찾을 수 없습니다.');
    const official = isStatutoryTemplate(await loadWorkbook(form.file));
    if (official) {
      if (onlyMissing) throw badRequest('16시트 최종 보고 양식에는 미이수 직원만 출력할 수 없습니다.');
      const check = await checkFinalExport(db, { year, scope, departmentId }, await countDrafts(db, user, year, departmentId));
      if (!check.ready) throw new HttpError(409, `최종 보고 기준이 충족되지 않았습니다. 교육 기준 확인 ${check.missingTrainings.length}개, 미충족 ${check.blockers.length}항목, 검수 대기 ${check.drafts}건을 먼저 확인해 주세요.`);
    }
    const people = await loadFormPeople(db, { year, scope, departmentId, onlyMissing });
    if (people.length === 0) throw badRequest(onlyMissing ? '미이수·부분이수인 직원이 없습니다.' : '양식에 쓸 직원이 없습니다.');

    const org = await getSetting(db, 'org', { name: '' });
    const fill = (group: FormPersonRow[], departmentName: string) =>
      official ? buildStatutoryWorkbook(db, { year, scope, departmentId: group.length && group.every(p => p.departmentId === group[0].departmentId) ? group[0].departmentId ?? undefined : departmentId }, form.file, group.length && group.every(p => p.departmentId === group[0].departmentId) ? group[0].departmentId : undefined) : fillForm({
        file: form.file,
        layout: { sheetName: form.sheet_name, headerFirst: form.header_first, headerLast: form.header_last, dataFirst: form.data_first, footerRow: form.footer_row },
        columns: JSON.parse(form.columns),
        markStyle: form.mark_style as FormMarkStyle,
        people: group,
        placeholders: { 기관명: org.name, 부서명: departmentName, 연도: String(year), 작성일: todayKorean(), 작성자: user.name },
      });
    const formName = safeName(form.name);
    const groups = split && !departmentId ? byDepartment(people) : [people];
    await audit(db, req, 'export.form', { type: 'form', id: form.id }, { year, scope: label, form: form.name, employees: people.length, files: groups.length, onlyMissing, reason });

    if (groups.length === 1) {
      // {부서명}: 한 부서 사람만 있으면 그 부서, 여러 부서면 범위 이름(전체 부서 등)
      const oneDepartment = people.every((p) => p.departmentId === people[0].departmentId);
      const buffer = await fill(people, oneDepartment ? (people[0].department ?? label) : label);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', contentDisposition(`${year}년_${formName}${filePart}_${today()}.xlsx`, 'form.xlsx'));
      return reply.send(buffer);
    }
    const archive = new ZipArchive({ zlib: { level: 6 } });
    for (const group of groups) {
      const name = group[0].department ?? '부서 없음';
      archive.append(await fill(group, name), { name: `${year}년_${formName}_${safeName(name)}.xlsx` });
    }
    void archive.finalize();
    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', contentDisposition(`${year}년_${formName}_부서별_${today()}.zip`, 'forms.zip'));
    return reply.send(archive);
  });
}
