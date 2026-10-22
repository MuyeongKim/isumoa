import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { BatchSummary, FileUploadResult, ProcessingStatus, SessionUser } from '../../../shared/types.ts';
import { currentUser, requireUser } from '../auth/guard.ts';
import { scopeOf } from '../certs/review.ts';
import type { Deps } from '../deps.ts';
import { enqueuePageJob } from '../jobs/queue.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { cleanOrNull } from '../lib/text.ts';
import { detectUploadType, filesDir, originalPath, pageImagePath, pagesDir } from '../storage.ts';

// 이수증 올리기: 묶음 만들기 → 원본 파일 올리기 → 화면이 쪼갠 쪽 이미지를 한 쪽씩 올리기.
// 쪽이 올라오면 처리 대기열에 넣는다. 같은 파일을 다시 올리면 빠진 쪽부터 이어 올리게 알려 준다.

const MAX_FILE_BYTES = 300 * 1024 * 1024;
const MAX_PAGE_IMAGE_BYTES = 15 * 1024 * 1024;

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const BatchBody = z.object({
  year: z.number().int().min(2000).max(2100),
  title: z.string().trim().max(100).nullable().optional(),
});
const PageFields = z.object({
  pageNo: z.coerce.number().int().min(1),
  width: z.coerce.number().int().min(1).max(20000),
  height: z.coerce.number().int().min(1).max(20000),
  text: z.string().max(200_000).default(''),
});

function isJpeg(buf: Buffer | undefined): buf is Buffer {
  return !!buf && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/** RFC 5987: 한글 파일 이름으로 내려받기 */
function contentDisposition(fileName: string): string {
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function uploadRoutes(app: FastifyInstance, { db, config, worker }: Deps) {
  /** 묶음을 다룰 수 있는지: 관리자이거나 올린 사람 */
  async function ownedBatch(user: SessionUser, batchId: number) {
    const batch = await db.selectFrom('batches').selectAll().where('id', '=', batchId).executeTakeFirst();
    if (!batch) throw notFound('올린 묶음을 찾을 수 없습니다.');
    if (user.role !== 'admin' && batch.created_by !== user.id) throw new HttpError(403, '내가 올린 묶음만 다룰 수 있습니다.');
    return batch;
  }

  /** 쪽 이미지를 볼 수 있는지: 관리자, 올린 사람, 또는 그 쪽의 이수증이 담당 부서 직원 것 */
  async function canViewPage(user: SessionUser, pageId: number) {
    const page = await db
      .selectFrom('pages as p')
      .innerJoin('files as f', 'f.id', 'p.file_id')
      .innerJoin('batches as b', 'b.id', 'f.batch_id')
      .select(['p.file_id', 'p.page_no', 'b.created_by'])
      .where('p.id', '=', pageId)
      .executeTakeFirst();
    if (!page) throw notFound('쪽을 찾을 수 없습니다.');
    const scope = scopeOf(user);
    if (scope === null || page.created_by === user.id) return page;
    const mine = await db
      .selectFrom('certificates as c')
      .innerJoin('employees as e', 'e.id', 'c.employee_id')
      .select('c.id')
      .where('c.page_id', '=', pageId)
      .where('e.department_id', 'in', scope.length ? scope : [-1])
      .executeTakeFirst();
    if (!mine) throw new HttpError(403, '볼 수 없는 이수증입니다.');
    return page;
  }

  app.post('/api/batches', { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const body = BatchBody.parse(req.body);
    const batch = await db
      .insertInto('batches')
      .values({ year: body.year, title: cleanOrNull(body.title), created_by: user.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await audit(db, req, 'batch.create', { type: 'batch', id: batch.id }, { year: body.year });
    return { id: batch.id };
  });

  app.get('/api/batches', { preHandler: requireUser }, async (req): Promise<BatchSummary[]> => {
    const user = currentUser(req);
    const rows = await db
      .selectFrom('batches as b')
      .innerJoin('users as u', 'u.id', 'b.created_by')
      .select((eb) => [
        'b.id',
        'b.year',
        'b.title',
        'b.created_at',
        'u.name as created_by',
        eb.selectFrom('files').select(eb.fn.countAll<number>().as('n')).whereRef('files.batch_id', '=', 'b.id').as('files'),
        eb.selectFrom('files').select((sub) => sub.fn.sum<number>('page_count').as('n')).whereRef('files.batch_id', '=', 'b.id').as('pages_expected'),
        eb
          .selectFrom('pages')
          .innerJoin('files', 'files.id', 'pages.file_id')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('files.batch_id', '=', 'b.id')
          .as('pages'),
        eb
          .selectFrom('pages')
          .innerJoin('files', 'files.id', 'pages.file_id')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('files.batch_id', '=', 'b.id')
          .where('pages.state', 'in', ['queued', 'processing'])
          .as('pages_waiting'),
        eb
          .selectFrom('pages')
          .innerJoin('files', 'files.id', 'pages.file_id')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('files.batch_id', '=', 'b.id')
          .where('pages.state', '=', 'error')
          .as('pages_error'),
        ...(['draft', 'confirmed', 'excluded'] as const).map((status) =>
          eb
            .selectFrom('certificates')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('certificates.batch_id', '=', 'b.id')
            .where('certificates.status', '=', status)
            .as(status),
        ),
      ])
      .$if(user.role !== 'admin', (qb) => qb.where('b.created_by', '=', user.id))
      .orderBy('b.id', 'desc')
      .limit(50)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      year: r.year,
      title: r.title,
      createdBy: r.created_by,
      createdAt: r.created_at,
      files: Number(r.files ?? 0),
      pagesExpected: Number(r.pages_expected ?? 0),
      pages: Number(r.pages ?? 0),
      pagesWaiting: Number(r.pages_waiting ?? 0),
      pagesError: Number(r.pages_error ?? 0),
      drafts: Number(r.draft ?? 0),
      confirmed: Number(r.confirmed ?? 0),
      excluded: Number(r.excluded ?? 0),
    }));
  });

  // 다시 읽기: 교육 키워드를 고쳤거나 읽는 방식이 바뀌었을 때. 검수 대기 이수증만 있는 쪽을 대기열에 다시 넣는다.
  // 확정·제외한 쪽은 건드리지 않고, OCR 결과는 저장해 둔 것을 다시 쓴다.
  app.post('/api/batches/:id/reprocess', { preHandler: requireUser }, async (req) => {
    const { id } = IdParams.parse(req.params);
    await ownedBatch(currentUser(req), id);
    const pages = await db
      .selectFrom('pages as p')
      .innerJoin('files as f', 'f.id', 'p.file_id')
      .select('p.id')
      .where('f.batch_id', '=', id)
      .where('p.state', 'in', ['done', 'error'])
      .where((eb) =>
        eb.not(
          eb.exists(eb.selectFrom('certificates as c').select('c.id').whereRef('c.page_id', '=', 'p.id').where('c.status', '!=', 'draft')),
        ),
      )
      .execute();
    await db.transaction().execute(async (trx) => {
      for (const page of pages) {
        await trx.updateTable('pages').set({ state: 'queued', error: null }).where('id', '=', page.id).execute();
        await enqueuePageJob(trx, page.id);
      }
    });
    worker?.notify();
    await audit(db, req, 'batch.reprocess', { type: 'batch', id }, { pages: pages.length });
    return { queued: pages.length };
  });

  // 원본 파일. 화면이 먼저 쪽 수를 세어 pageCount로 함께 보낸다 (파일보다 앞에 넣어야 한다)
  app.post('/api/batches/:id/files', { preHandler: requireUser }, async (req): Promise<FileUploadResult> => {
    const user = currentUser(req);
    const { id: batchId } = IdParams.parse(req.params);
    await ownedBatch(user, batchId);

    const part = await req.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!part) throw badRequest('파일을 골라 주세요.');
    const field = (name: string) => {
      const f = part.fields[name];
      return f && !Array.isArray(f) && f.type === 'field' ? String(f.value) : undefined;
    };
    const pageCount = z.coerce.number().int().min(1).max(2000).parse(field('pageCount'));
    const force = field('force') === '1';

    await mkdir(filesDir(config.dataDir), { recursive: true });
    const tmp = originalPath(config.dataDir, `.upload-${randomUUID()}`);
    const hash = createHash('sha256');
    let head = Buffer.alloc(0);
    let size = 0;
    await pipeline(
      part.file,
      new Transform({
        transform(chunk: Buffer, _enc, done) {
          if (head.length < 8) head = Buffer.concat([head, chunk.subarray(0, 8)]);
          hash.update(chunk);
          size += chunk.length;
          done(null, chunk);
        },
      }),
      createWriteStream(tmp),
    );
    const discard = () => rm(tmp, { force: true });
    if (part.file.truncated) {
      await discard();
      throw new HttpError(413, '파일이 너무 큽니다 (300MB까지).');
    }
    const type = detectUploadType(head);
    if (!type) {
      await discard();
      throw badRequest('PDF, JPG, PNG 파일만 올릴 수 있습니다.');
    }
    const sha256 = hash.digest('hex');

    // 같은 묶음에 같은 파일이 있으면 이어 올리기
    const same = await db.selectFrom('files').select('id').where('batch_id', '=', batchId).where('sha256', '=', sha256).executeTakeFirst();
    if (same) {
      await discard();
      const pages = await db.selectFrom('pages').select('page_no').where('file_id', '=', same.id).execute();
      return { fileId: same.id, duplicateOf: null, uploadedPages: pages.map((p) => p.page_no) };
    }
    if (!force) {
      const earlier = await db
        .selectFrom('files')
        .select(['batch_id', 'original_name', 'created_at'])
        .where('sha256', '=', sha256)
        .orderBy('id')
        .executeTakeFirst();
      if (earlier) {
        await discard();
        return { fileId: null, duplicateOf: { batchId: earlier.batch_id, fileName: earlier.original_name, createdAt: earlier.created_at }, uploadedPages: [] };
      }
    }

    const storedName = `${randomUUID()}.${type.ext}`;
    await rename(tmp, originalPath(config.dataDir, storedName));
    const created = await db
      .insertInto('files')
      .values({
        batch_id: batchId,
        original_name: part.filename.normalize('NFC'),
        stored_name: storedName,
        mime: type.mime,
        size,
        sha256,
        page_count: type.mime === 'application/pdf' ? pageCount : 1,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { fileId: created.id, duplicateOf: null, uploadedPages: [] };
  });

  // 쪽 하나: 큰 이미지(image), 작은 이미지(thumb), PDF 글자층(text)
  app.post('/api/files/:id/pages', { preHandler: requireUser }, async (req) => {
    const user = currentUser(req);
    const { id: fileId } = IdParams.parse(req.params);
    const file = await db.selectFrom('files').selectAll().where('id', '=', fileId).executeTakeFirst();
    if (!file) throw notFound('파일을 찾을 수 없습니다.');
    await ownedBatch(user, file.batch_id);

    const fields: Record<string, string> = {};
    const images: Record<string, Buffer> = {};
    for await (const part of req.parts({ limits: { fileSize: MAX_PAGE_IMAGE_BYTES, files: 2 } })) {
      if (part.type === 'file') {
        images[part.fieldname] = await part.toBuffer();
        if (part.file.truncated) throw new HttpError(413, '쪽 이미지가 너무 큽니다.');
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    const meta = PageFields.parse(fields);
    if (meta.pageNo > file.page_count) throw badRequest('쪽 번호가 파일의 쪽 수보다 큽니다.');
    if (!isJpeg(images.image) || !isJpeg(images.thumb)) throw badRequest('쪽 이미지는 JPEG여야 합니다.');

    const existing = await db.selectFrom('pages').select('id').where('file_id', '=', fileId).where('page_no', '=', meta.pageNo).executeTakeFirst();
    if (existing) return { pageId: existing.id };

    await mkdir(pagesDir(config.dataDir, fileId), { recursive: true });
    await writeFile(pageImagePath(config.dataDir, fileId, meta.pageNo, 'image'), images.image);
    await writeFile(pageImagePath(config.dataDir, fileId, meta.pageNo, 'thumb'), images.thumb);
    const pageId = await db.transaction().execute(async (trx) => {
      const page = await trx
        .insertInto('pages')
        .values({
          file_id: fileId,
          page_no: meta.pageNo,
          width: meta.width,
          height: meta.height,
          text_layer: meta.text.normalize('NFC') || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await enqueuePageJob(trx, page.id);
      return page.id;
    });
    worker?.notify();
    return { pageId };
  });

  // 브라우저가 매번 바뀌었는지만 물어보게 한다(ETag). DB를 백업에서 되돌리면 같은 번호에 다른 이미지가 올 수 있어서
  // 오래 저장해 두지 않는다.
  async function sendPageImage(req: FastifyRequest, reply: FastifyReply, path: string) {
    const info = await stat(path);
    const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.header('Content-Type', 'image/jpeg');
    return reply.send(createReadStream(path));
  }

  app.get('/api/pages/:id/image', { preHandler: requireUser }, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const page = await canViewPage(currentUser(req), id);
    return sendPageImage(req, reply, pageImagePath(config.dataDir, page.file_id, page.page_no, 'image'));
  });

  app.get('/api/pages/:id/thumb', { preHandler: requireUser }, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const page = await canViewPage(currentUser(req), id);
    return sendPageImage(req, reply, pageImagePath(config.dataDir, page.file_id, page.page_no, 'thumb'));
  });

  app.get('/api/files/:id/original', { preHandler: requireUser }, async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const file = await db.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
    if (!file) throw notFound('파일을 찾을 수 없습니다.');
    await ownedBatch(currentUser(req), file.batch_id);
    await audit(db, req, 'file.download', { type: 'file', id });
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', contentDisposition(file.original_name));
    return reply.send(createReadStream(originalPath(config.dataDir, file.stored_name)));
  });

  // 처리 대기 현황 (내가 볼 수 있는 묶음 기준)
  app.get('/api/processing', { preHandler: requireUser }, async (req): Promise<ProcessingStatus> => {
    const user = currentUser(req);
    const counts = await db
      .selectFrom('jobs as j')
      .innerJoin('pages as p', 'p.id', 'j.page_id')
      .innerJoin('files as f', 'f.id', 'p.file_id')
      .innerJoin('batches as b', 'b.id', 'f.batch_id')
      .select(['j.state', (eb) => eb.fn.countAll<number>().as('n')])
      .where('j.state', 'in', ['queued', 'running', 'failed'])
      .$if(user.role !== 'admin', (qb) => qb.where('b.created_by', '=', user.id))
      .groupBy('j.state')
      .execute();
    const of = (state: string) => Number(counts.find((c) => c.state === state)?.n ?? 0);
    const waiting = of('queued');
    const running = of('running');
    const average = worker?.averageMs() ?? null;
    return {
      waiting,
      running,
      failed: of('failed'),
      etaSeconds: average !== null && waiting + running > 0 ? Math.round(((waiting + running) * average) / 1000) : null,
    };
  });
}
