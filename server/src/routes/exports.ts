import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZIP_LAYOUTS, type ExportSummary } from '../../../shared/types.ts';
import { assertDepartmentInScope, currentUser, departmentScope, requireUser } from '../auth/guard.ts';
import { getSetting } from '../db/seed.ts';
import type { Deps } from '../deps.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { contentDisposition } from '../lib/http.ts';
import { buildStatusWorkbook } from '../reports/excel.ts';
import { buildEvidenceZip, buildMergedPdf } from '../reports/evidence.ts';
import { safeName } from '../reports/fileNames.ts';
import { loadRecords } from '../reports/records.ts';
import { loadStatusReport } from '../reports/statusReport.ts';
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
  trainingId: z.coerce.number().int().positive().optional(),
});
const PdfQuery = DownloadQuery.extend({ trainingId: z.coerce.number().int().positive() });

function today(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('-', '');
}

export async function exportRoutes(app: FastifyInstance, { db, config }: Deps) {
  /** 요청한 범위를 확인하고, 파일 이름·제목에 쓸 범위 이름을 돌려준다 */
  async function resolveScope(req: FastifyRequest, departmentId: number | undefined) {
    const user = currentUser(req);
    const scope = departmentScope(user);
    if (departmentId !== undefined) assertDepartmentInScope(user, departmentId);
    const department = departmentId
      ? await db.selectFrom('departments').select('name').where('id', '=', departmentId).executeTakeFirst()
      : undefined;
    if (departmentId && !department) throw notFound('부서를 찾을 수 없습니다.');
    const label = department ? department.name : scope === null ? '전체 부서' : `담당 부서(${user.departments.map((d) => d.name).join(', ') || '없음'})`;
    return { user, scope, label, filePart: department ? `_${safeName(department.name)}` : '' };
  }

  // 내보내기 화면: 범위 안의 확정 이수증 수와 교육별 수
  app.get('/api/exports/summary', { preHandler: requireUser }, async (req): Promise<ExportSummary> => {
    const { year, departmentId } = ExportQuery.parse(req.query);
    const { user, scope } = await resolveScope(req, departmentId);
    const records = await loadRecords(db, { year, scope, departmentId });
    const report = await loadStatusReport(db, { year, scope, departmentId });
    return {
      year,
      certificates: new Set(records.map((r) => r.certificateId)).size,
      drafts: await countDrafts(db, user, year, departmentId),
      trainings: report.trainings.map((t) => ({
        trainingId: t.id,
        name: t.name,
        certificates: records.filter((r) => r.trainingId === t.id).length,
      })),
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
    const { year, departmentId, layout, trainingId, reason } = ZipQuery.parse(req.query);
    const { scope, label, filePart } = await resolveScope(req, departmentId);
    const records = await loadRecords(db, { year, scope, departmentId, trainingId });
    if (records.length === 0) throw badRequest('내보낼 확정 이수증이 없습니다.');
    const trainingPart = trainingId ? `_${safeName(records[0].trainingName)}` : '';
    await audit(db, req, 'export.zip', undefined, { year, scope: label, layout, trainingId: trainingId ?? null, files: records.length, reason });
    reply.header('Content-Type', 'application/zip');
    reply.header(
      'Content-Disposition',
      contentDisposition(`${year}년_이수증_${layout === 'training' ? '교육별' : '부서별'}${filePart}${trainingPart}.zip`, 'certificates.zip'),
    );
    return reply.send(buildEvidenceZip(records, layout, config.dataDir));
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
}
