import { readFile } from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import { PDFDocument } from 'pdf-lib';
import type { ZipLayout } from '../../../shared/types.ts';
import { personalTitle } from '../../../shared/exportTitles.ts';
import { originalPath, pageImagePath } from '../storage.ts';
import { certificateBaseName, safeName, UniqueNames } from './fileNames.ts';
import type { CertificateRecord } from './records.ts';

// 증빙 자료: 이수증 ZIP과 교육별 합본 PDF.
// 이수증 쪽은 올린 원본 PDF에서 그 쪽을 그대로 옮겨 온다 (글자 정보·화질 유지).
// 원본을 열 수 없으면(암호 걸린 PDF 등) 서버에 저장한 쪽 이미지로 대신 만든다.

const A4 = { width: 595.28, height: 841.89 };

/** 원본 파일을 한 번만 열어 여러 쪽을 꺼내 쓴다 (스캔 묶음 PDF 하나에 이수증이 수십 장) */
export class CertificatePages {
  private readonly originals = new Map<number, Promise<PDFDocument | null>>();
  private readonly singles = new Map<number, Promise<Uint8Array>>();
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private original(rec: CertificateRecord): Promise<PDFDocument | null> {
    let doc = this.originals.get(rec.fileId);
    if (!doc) {
      doc = (async () => {
        if (rec.mime !== 'application/pdf') return null;
        try {
          const loaded = await PDFDocument.load(await readFile(originalPath(this.dataDir, rec.storedName)), { ignoreEncryption: true });
          // 망가진 PDF도 열리기는 해서, 쪽 목록을 읽어 봐야 쓸 수 있는지 안다
          return loaded.isEncrypted || loaded.getPageCount() === 0 ? null : loaded;
        } catch {
          return null;
        }
      })();
      this.originals.set(rec.fileId, doc);
    }
    return doc;
  }

  /** 이수증 쪽을 target 문서 끝에 붙인다 */
  async appendTo(target: PDFDocument, rec: CertificateRecord): Promise<void> {
    const source = await this.original(rec);
    if (source && rec.pageNo <= source.getPageCount()) {
      try {
        const [page] = await target.copyPages(source, [rec.pageNo - 1]);
        target.addPage(page);
        return;
      } catch {
        // 그 쪽만 망가졌으면 아래의 쪽 이미지로
      }
    }
    // 이미지로 올린 이수증은 원본 이미지를, 그 밖에는 저장한 쪽 이미지를 쓴다
    const isImage = rec.mime === 'image/jpeg' || rec.mime === 'image/png';
    const bytes = await readFile(isImage ? originalPath(this.dataDir, rec.storedName) : pageImagePath(this.dataDir, rec.fileId, rec.pageNo, 'image'));
    const image = rec.mime === 'image/png' && isImage ? await target.embedPng(bytes) : await target.embedJpg(bytes);
    const landscape = image.width > image.height;
    const pageSize = landscape ? { width: A4.height, height: A4.width } : A4;
    const scale = Math.min(pageSize.width / image.width, pageSize.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    const page = target.addPage([pageSize.width, pageSize.height]);
    page.drawImage(image, { x: (pageSize.width - w) / 2, y: (pageSize.height - h) / 2, width: w, height: h });
  }

  /** 이수증 한 장짜리 PDF (같은 이수증이 여러 교육 폴더에 들어가도 한 번만 만든다) */
  single(rec: CertificateRecord): Promise<Uint8Array> {
    let pdf = this.singles.get(rec.certificateId);
    if (!pdf) {
      pdf = (async () => {
        const doc = await PDFDocument.create();
        doc.setTitle(`${rec.employeeName} ${rec.courseTitle ?? rec.trainingName} 이수증`);
        await this.appendTo(doc, rec);
        return doc.save();
      })();
      this.singles.set(rec.certificateId, pdf);
    }
    return pdf;
  }
}

/** ZIP 안 경로: 교육별이면 "교육명/…", 부서별이면 "부서/…" */
export function zipEntryNames(records: CertificateRecord[], layout: ZipLayout): string[] {
  const names = new UniqueNames();
  return records.map((r) => {
    const folder = safeName(layout === 'training' ? r.trainingName : layout === 'employee' ? `${r.departmentName ?? '부서없음'}_${r.employeeName}${r.empNo ? `_${r.empNo}` : `_${r.employeeId}`}` : (r.departmentName ?? '부서없음'));
    return names.take(folder, certificateBaseName(r), '.pdf');
  });
}

/**
 * 이수증 ZIP을 만들며 흘려보낸다. 파일 이름은 UTF-8 표시를 달아 Windows 탐색기에서 한글이 깨지지 않는다.
 * PDF·JPEG는 이미 압축되어 있어 빠르게 묶기만 한다.
 */
export function buildEvidenceZip(records: CertificateRecord[], layout: ZipLayout, dataDir: string): ZipArchive {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const pages = new CertificatePages(dataDir);
  const names = zipEntryNames(records, layout);
  // 한 장씩 써 넣은 뒤 다음 장을 만든다 (받는 쪽이 느려도 메모리에 쌓이지 않게)
  const written = () =>
    new Promise<void>((resolve, reject) => {
      const done = (err?: unknown) => {
        archive.off('entry', ok).off('error', fail).off('close', closed);
        if (err) reject(err);
        else resolve();
      };
      const ok = () => done();
      const fail = (err: Error) => done(err);
      const closed = () => done(new Error('내려받기가 중단되었습니다.'));
      archive.once('entry', ok).once('error', fail).once('close', closed);
    });
  void (async () => {
    try {
      for (const [i, rec] of records.entries()) {
        const pdf = await pages.single(rec);
        archive.append(Buffer.from(pdf), { name: names[i], date: new Date(rec.confirmedAt ?? Date.now()) });
        await written(); // 'entry'는 append 뒤에 비동기로 오므로 여기서 기다려도 놓치지 않는다
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return archive;
}

/** 교육 하나의 이수증을 부서·성명 순서로 한 PDF에 모은다 (records는 한 교육만) */
export async function buildMergedPdf(records: CertificateRecord[], title: string, dataDir: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  const pages = new CertificatePages(dataDir);
  const seen = new Set<number>();
  for (const rec of records) {
    if (seen.has(rec.certificateId)) continue;
    seen.add(rec.certificateId);
    await pages.appendTo(doc, rec);
  }
  return doc.save();
}

/** 직원 한 명당 합본 하나. 통합과정의 중복 인정 쪽은 한 번만 넣는다. */
export function buildPersonalZip(records: CertificateRecord[], template: string, year: number, dataDir: string) {
  const archive = new ZipArchive({ zlib: { level: 1 } });
  const groups = new Map<number, CertificateRecord[]>();
  for (const r of records) { const group = groups.get(r.employeeId) ?? []; group.push(r); groups.set(r.employeeId, group); }
  const names = new UniqueNames();
  const pages = new CertificatePages(dataDir);
  void (async () => {
    try {
      for (const group of groups.values()) {
        if (archive.destroyed) break;
        const person = group[0];
        const title = personalTitle(template, { 연도: String(year), 부서: person.departmentName ?? '부서없음', 성명: person.employeeName, 사번: person.empNo ?? String(person.employeeId) });
        const doc = await PDFDocument.create(); doc.setTitle(title);
        const seen = new Set<number>();
        for (const rec of group) { if (seen.has(rec.certificateId)) continue; seen.add(rec.certificateId); await pages.appendTo(doc, rec); }
        const pdf = await doc.save();
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { archive.off('entry', done).off('error', fail).off('close', closed); };
          const done = () => { cleanup(); resolve(); };
          const fail = (err: Error) => { cleanup(); reject(err); };
          const closed = () => fail(new Error('내려받기가 중단되었습니다.'));
          archive.once('entry', done).once('error', fail).once('close', closed);
          archive.append(Buffer.from(pdf), { name: names.take('', safeName(title), '.pdf') });
        });
      }
      if (!archive.destroyed) await archive.finalize();
    } catch (err) { archive.destroy(err instanceof Error ? err : new Error(String(err))); }
  })();
  return archive;
}
