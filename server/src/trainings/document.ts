import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IRBlock } from 'kordoc';
import { PDFDocument } from 'pdf-lib';
import type { TrainingDocumentPreview, TrainingImportDraft } from '../../../shared/types.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import type { OcrEngine, OcrTextLine } from '../ocr/engine.ts';
import { parseCertificateText } from '../certs/parseText.ts';
import { markdownToText } from '../ocr/kordoc.ts';

const compact = (s: string) => s.normalize('NFC').replace(/\s/g, '');
const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[*`]/g, '').replace(/\\([()[\]_.])/g, '$1').trim();
const titleHeader = /^(?:교육명|과정명|교육과정명?|교육분야|교육과목|과목명|교육주제|교육내용|교육)$/;
const trainingNameLine = /^(?:[-○ㅇ•]\s*)?(?:교\s*육\s*명|과\s*정\s*명|교육\s*과정(?:명)?)(?:\s*[:：]\s*|\s+)(.+)$/;

/** 수료증에 적힌 개인 수료시간을 기관의 연간 의무 기준으로 오인하지 않는다. */
function certificateTraining(text: string): TrainingImportDraft[] | null {
  text = markdownToText(text.replace(/<br\s*\/?>/gi, '\n')).replace(/^#{1,6}\s*/gm, '');
  if (!/^\s*(?:교\s*육\s*)?(?:수\s*료|이\s*수)\s*증\s*$/m.test(text)) return null;
  const parsed = parseCertificateText(text);
  if (!parsed.courseTitle) return null;
  const evidence = [`과정명: ${parsed.courseTitle}`, `실제 수료시간: ${parsed.hoursText ?? '미기재'}`, ...(parsed.provider ? [`교육기관: ${parsed.provider}`] : [])].join('\n');
  return [{ name: parsed.courseTitle, category: null, legalBasis: null, reqType: parsed.hours === null ? null : 'hours', reqValue: null,
    keywords: [], fromYear: null, toYear: null, note: evidence.slice(0, 500), source: evidence,
    warnings: ['수료증에서 읽은 과정입니다. 개인 수료시간과 기관의 연간 의무 기준은 다를 수 있으니 교육 이름·연간 기준·인식 키워드를 확인해 입력해 주세요.', ...parsed.notes.map(note => note.message)] }];
}

/** 번호가 있는 사진 표: 번호는 행 경계, 머리글의 가로 위치는 열 경계로 쓴다. */
export function trainingTableFromOcr(lines: readonly OcrTextLine[]): IRBlock[] {
  const cx = (line: OcrTextLine) => line.box.x + line.box.w / 2;
  const cy = (line: OcrTextLine) => line.box.y + line.box.h / 2;
  const title = lines.find(line => titleHeader.test(compact(line.text)));
  if (!title) return [];
  const headers = lines.filter(line =>
    Math.abs(cy(line) - cy(title)) <= Math.max(title.box.h, line.box.h) * 2 &&
    (titleHeader.test(compact(line.text)) || /^(?:수강신청|교육기관|검색어|키워드|인식키워드|이수기준|교육시간|이수시간|횟수|교육대상|분류|구분|근거법령|관련법령|적용연도)$/.test(compact(line.text))),
  ).sort((a, b) => cx(a) - cx(b));
  if (headers.length < 2 || !headers.some(line => /기준|시간|횟수/.test(compact(line.text)))) return [];
  const candidates = lines.filter(line => /^\d{1,3}$/.test(line.text.trim()) && cx(line) < cx(headers[0]) && cy(line) > cy(title) + title.box.h / 2);
  if (candidates.length < 2) return [];
  const left = Math.min(...candidates.map(cx));
  const anchors = candidates.filter(line => cx(line) <= left + (cx(headers[0]) - left) * 0.35).sort((a, b) => cy(a) - cy(b));
  if (anchors.length < 2 || anchors.some((line, i) => i > 0 && Number(line.text) !== Number(anchors[i - 1].text) + 1)) return [];
  const rows: string[][] = [headers.map(line => compact(line.text))];
  for (const [index, anchor] of anchors.entries()) {
    const center = cy(anchor);
    const top = index === 0 ? center - (cy(anchors[1]) - center) / 2 : (cy(anchors[index - 1]) + center) / 2;
    const bottom = index === anchors.length - 1 ? center + (center - cy(anchors[index - 1])) / 2 : (center + cy(anchors[index + 1])) / 2;
    const cells: OcrTextLine[][] = headers.map(() => []);
    for (const line of lines) {
      if (cy(line) < top || cy(line) >= bottom || anchors.includes(line) || headers.includes(line) || /^[✓✔√☑✅]+$/.test(line.text.trim())) continue;
      let column = 0;
      for (let c = 1; c < headers.length; c++) if (Math.abs(cx(line) - cx(headers[c])) < Math.abs(cx(line) - cx(headers[column]))) column = c;
      cells[column].push(line);
    }
    rows.push(cells.map(cell => cell.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x).map(line => line.text).join('\n')));
  }
  return [{ type: 'table', table: { rows: rows.length, cols: headers.length, hasHeader: true, cells: rows.map(row => row.map(text => ({ text, rowSpan: 1, colSpan: 1 }))) } }];
}

function requirement(text: string, hint = ''): Pick<TrainingImportDraft, 'reqType' | 'reqValue' | 'warnings'> {
  const value = compact(text).replace(/,/g, '');
  const hours = value.match(/(\d+(?:\.\d+)?)시간(?:([0-9]+)분)?/);
  const minutes = value.match(/(\d+(?:\.\d+)?)분/);
  const count = value.match(/(\d+(?:\.\d+)?)회/);
  if (hours) return { reqType: 'hours', reqValue: Number(hours[1]) + Number(hours[2] ?? 0) / 60, warnings: count ? ['시간과 횟수가 함께 적혀 있습니다. 적용할 기준을 확인해 주세요.'] : [] };
  if (minutes) return { reqType: 'hours', reqValue: Number(minutes[1]) / 60, warnings: [] };
  if (count) return { reqType: 'count', reqValue: Number(count[1]), warnings: [] };
  if (/^\d+(?:\.\d+)?$/.test(value) && /시간|횟수/.test(hint)) return { reqType: hint.includes('시간') ? 'hours' : 'count', reqValue: Number(value), warnings: [] };
  return { reqType: null, reqValue: null, warnings: ['이수 기준을 찾지 못했습니다. 시간 또는 횟수를 입력해 주세요.'] };
}

function draft(name: string, text: string, hint = ''): TrainingImportDraft {
  const title = clean(name).replace(/^(?:\d+[.)]|[가-하][.)]|[①-⑳])\s*/, '').trim().slice(0, 100);
  const req = requirement(text, hint);
  if (/분기|매월|월\s*\d+회|신규|입사\s*시/.test(text)) req.warnings.push('연간 기준 외의 주기·대상 조건이 있습니다. 연간 이수 기준과 메모에 적용할 내용을 확인해 주세요.');
  return { name: title, category: null, legalBasis: null, ...req, keywords: title ? [title] : [], fromYear: null, toYear: null, note: null, source: text.slice(0, 1200) };
}

/** 표의 머리글과 문단의 명시적 교육명 항목을 읽는다. 법령·기준을 추측해 채우지 않는다. */
export function extractTrainingDrafts(blocks: IRBlock[], markdown: string): TrainingImportDraft[] {
  const found: TrainingImportDraft[] = [];
  const narrative: string[] = [];
  function visit(items: IRBlock[]) {
    for (const b of items) {
      if (b.table) {
        const rows = b.table.cells.map(row => row.map(c => clean(c.text)));
        const headerIndex = rows.findIndex(row => row.some(c => titleHeader.test(compact(c))));
        const vertical = rows.every(row => row.length <= 2) && rows.slice(1).some(row => /^(교육명|과정명|교육시간|이수기준|근거법령|적용연도|교육대상|분류)$/.test(compact(row[0] ?? '')));
        if (headerIndex >= 0 && !vertical) {
          const headers = rows[headerIndex].map(compact);
          const nameCol = headers.findIndex(c => titleHeader.test(c));
          const reqCols = headers.flatMap((c, i) => /시간|횟수|이수기준|교육기준/.test(c) ? [i] : []);
          const basisCol = headers.findIndex(c => /근거|법령/.test(c));
          const categoryCol = headers.findIndex(c => /분류|구분/.test(c));
          const keywordCol = headers.findIndex(c => /키워드|검색어/.test(c));
          const providerCol = headers.findIndex(c => /수강신청|교육기관/.test(c));
          const yearCol = headers.findIndex(c => /적용연도|대상연도/.test(c));
          for (const row of rows.slice(headerIndex + 1)) {
            const titleLines = (row[nameCol] ?? '').split('\n').map(part => clean(part).replace(/^[✓✔√☑✅]+\s*|\s*[✓✔√☑✅]+$/g, '')).filter(Boolean);
            const noteIndex = titleLines.findIndex((part, i) => i > 0 && /^[([（]/.test(part));
            const name = (noteIndex < 0 ? titleLines : titleLines.slice(0, noteIndex)).join(' ');
            if (!name || titleHeader.test(compact(name)) || /^(합계|계|소계|비고)$/.test(name)) continue;
            const source = row.map((c, i) => `${headers[i] ?? ''}: ${c}`).join(' / ');
            const reqText = reqCols.length ? reqCols.map(i => row[i] ?? '').join(' / ') : row.filter((_, i) => i !== nameCol).join(' ');
            const d = draft(name, reqText, reqCols.map(i => headers[i]).join(' '));
            d.source = source.slice(0, 1200);
            d.legalBasis = row[basisCol]?.slice(0, 300) || null;
            d.category = row[categoryCol]?.slice(0, 50) || null;
            const notes = [noteIndex < 0 ? '' : titleLines.slice(noteIndex).join(' '), row[providerCol] ? `수강신청: ${row[providerCol].replace(/\n/g, ', ')}` : ''].filter(Boolean);
            d.note = notes.join('\n').slice(0, 500) || null;
            if (/신규|입사\s*시|임용\s*후|분기|매월/.test(d.note ?? '')) d.warnings.push('신규자·교육 주기 등의 별도 조건이 있습니다. 메모를 원문과 대조해 주세요.');
            if (keywordCol >= 0) {
              d.keywords = (row[keywordCol] ?? '').split(/[,，;·\n]/).map(k => k.trim()).filter(Boolean).slice(0, 30);
              if ((row[keywordCol] ?? '').includes('\n')) d.warnings.push('검색어가 여러 줄입니다. 줄바꿈으로 나뉜 키워드를 확인해 주세요.');
            }
            const years = row[yearCol]?.match(/20\d{2}/g)?.map(Number) ?? [];
            if (years.length) { d.fromYear = years[0]; d.toYear = years.at(-1)!; }
            found.push(d);
          }
        } else narrative.push(...rows.map(row => row.join(' : ')));
        for (const row of b.table.cells) for (const cell of row) if (cell.blocks) visit(cell.blocks);
      } else if (b.text) narrative.push(b.text);
      if (b.children) visit(b.children);
    }
  }
  visit(blocks);

  // 표 밖의 "교육명: …"·"1. …교육" 항목도 지원한다.
  const lines = (blocks.length ? narrative.join('\n') : markdown)
    .replace(/\s+(교육명|과정명|교육과정명)\s*[:：]/g, '\n$1: ')
    .split('\n').map(clean).filter(l => l && !l.startsWith('|') && !/^<!--/.test(l));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^#+\s*/, '');
    const label = line.match(trainingNameLine);
    const heading = line.match(/^(?:\d+[.)]\s*|[○•]\s*)(.{2,70}교육)(?:\s*[:：-]\s*(.*))?$/);
    const inline = line.match(/^(.{2,70}교육)\s*[:：-]\s*(.*(?:시간|회|분).*)$/);
    const name = label?.[1] ?? heading?.[1] ?? inline?.[1];
    if (!name) continue;
    const section: string[] = [line];
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      if (trainingNameLine.test(lines[j]) || /^\d+[.)]\s*.+교육/.test(lines[j])) break;
      section.push(lines[j]);
    }
    const text = section.join('\n');
    const d = draft(name, text);
    d.legalBasis = text.match(/(?:근거(?:\s*법령)?|관련\s*법령)\s*[:：]\s*([^\n]+)/)?.[1]?.slice(0, 300) ?? null;
    d.category = text.match(/(?:분류|구분)\s*[:：]\s*([^\n]+)/)?.[1]?.slice(0, 50) ?? null;
    const years = text.match(/적용\s*연도\s*[:：]\s*(20\d{2})(?:\s*[~～-]\s*(20\d{2}))?/);
    if (years) { d.fromYear = Number(years[1]); d.toYear = Number(years[2] ?? years[1]); }
    found.push(d);
  }
  const unique = new Map<string, TrainingImportDraft>();
  for (const d of found) {
    if (!d.name) continue;
    const key = compact(d.name);
    const previous = unique.get(key);
    if (!previous || previous.reqValue === null && d.reqValue !== null) unique.set(key, d);
    else if (previous.reqType !== d.reqType || previous.reqValue !== d.reqValue) previous.warnings.push('같은 교육의 다른 기준이 문서에 있습니다. 원문을 대조해 주세요.');
  }
  return [...unique.values()];
}

export async function readTrainingDocument(buffer: Buffer, fileName: string, ocr?: Pick<OcrEngine, 'recognize' | 'recognizeWithLayout'>, textLayer?: string): Promise<TrainingDocumentPreview> {
  if (buffer.length > 20 * 1024 * 1024) throw badRequest('교육 문서는 20MB 이하로 올려 주세요.');
  const pdf = /\.pdf$/i.test(fileName);
  const image = /\.(jpe?g|png)$/i.test(fileName);
  if (!pdf && !image && !/\.hwpx$/i.test(fileName)) throw badRequest('PDF·HWPX·JPG·JPEG·PNG 파일을 올려 주세요. HWP 파일은 한글에서 HWPX로 저장해 주세요.');
  if (pdf) {
    try { if ((await PDFDocument.load(buffer)).getPageCount() > 100) throw new Error('too-many-pages'); }
    catch (err) { throw badRequest(err instanceof Error && err.message === 'too-many-pages' ? '교육 문서는 100쪽 이하로 나누어 올려 주세요.' : 'PDF를 읽지 못했습니다. 암호를 해제하고 다시 올려 주세요.'); }
  }
  const temp = await mkdtemp(join(tmpdir(), 'isumoa-training-'));
  try {
    let text: string;
    let blocks: IRBlock[] = [];
    let warnings: string[] = [];
    if (image) {
      // 확장자만 바꾼 파일을 받지 않는다. 큰 PNG는 디코딩하기 전에 픽셀 수부터 제한한다.
      let width: number;
      let height: number;
      const png = /\.png$/i.test(fileName);
      if (png) {
        if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.toString('ascii', 12, 16) !== 'IHDR') {
          throw badRequest('PNG 사진을 읽지 못했습니다. 정상적인 사진 파일을 다시 골라 주세요.');
        }
        width = buffer.readUInt32BE(16); height = buffer.readUInt32BE(20);
      } else {
        try {
          const doc = await PDFDocument.create();
          const jpg = await doc.embedJpg(buffer);
          width = jpg.width; height = jpg.height;
        } catch { throw badRequest('JPEG 사진을 읽지 못했습니다. 정상적인 JPG·JPEG 사진을 다시 골라 주세요.'); }
      }
      if (!width || !height || width * height > 40_000_000) throw badRequest('사진은 4,000만 화소 이하로 줄여서 올려 주세요.');
      if (!ocr) throw badRequest('사진을 읽을 OCR이 준비되지 않았습니다. 시스템 점검에서 OCR 상태를 확인해 주세요.');
      const path = join(temp, png ? 'training.png' : 'training.jpg');
      await writeFile(path, buffer, { mode: 0o600 });
      let uncertain = false;
      if (ocr.recognizeWithLayout) {
        const result = await ocr.recognizeWithLayout(path);
        text = result.text;
        blocks = trainingTableFromOcr(result.lines);
        uncertain = result.lines.some(line => line.text.length > 2 && line.confidence < 0.85);
      } else text = await ocr.recognize(path);
      warnings = [text.trim() ? '사진에서 글자를 읽었습니다. 교육명·시간·횟수를 원본 사진과 대조해 주세요.' : '사진에서 글자를 읽지 못했습니다. 글자가 크고 선명하게 보이도록 다시 촬영해 주세요.'];
      if (uncertain) warnings.push('글자가 작거나 흐린 부분이 있습니다. 부가설명·검색어·수강신청 정보를 원본과 대조해 주세요.');
    } else {
      process.env.KORDOC_OFFLINE = '1';
      const { parse } = await import('kordoc');
      const result = await parse(buffer, {
        plain: true, images: false, tableFormat: 'gfm', layoutTables: 'keep', removeHeaderFooter: false,
        ocr: pdf && ocr ? async (pageImage, page, mime) => {
          const path = join(temp, `page-${page}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`);
          await writeFile(path, pageImage, { mode: 0o600 });
          return ocr.recognize(path);
        } : false,
      });
      if (!result.success) throw badRequest('문서를 읽지 못했습니다. 암호·손상 여부를 확인하고 PDF 또는 HWPX로 다시 저장해 주세요.');
      if (result.fileType !== (pdf ? 'pdf' : 'hwpx')) throw badRequest('확장자와 문서 형식이 다릅니다. PDF 또는 HWPX 원본을 올려 주세요.');
      text = result.markdown;
      blocks = result.blocks;
      warnings = (result.warnings?.map(w => w.message.replace('사용자 프로바이더', '프로그램 내 OCR')) ?? []).slice(0, 10);
    }
    if (text.length > 300_000) throw badRequest('내용이 너무 많습니다. 교육 목록 부분만 나누어 올려 주세요.');
    const drafts = certificateTraining(pdf && textLayer ? textLayer : text) ?? extractTrainingDrafts(blocks, text);
    if (image && blocks[0]?.table && drafts.length !== blocks[0].table.rows - 1) warnings.push('표의 번호 개수와 읽은 교육 수가 다릅니다. 누락·중복된 교육을 원본과 대조해 주세요.');
    if (drafts.length > 200) throw badRequest('교육은 한 번에 200개까지 읽습니다. 문서를 나누어 올려 주세요.');
    return { fileName, drafts, text: text.slice(0, 50_000), warnings: [
      ...warnings,
      ...(drafts.length === 0 ? ['교육 목록을 찾지 못했습니다. 아래 읽은 글을 확인하고 교육명을 직접 입력해 주세요.'] : []),
      '문서에서 읽은 값입니다. 적용 대상·주기·기준을 원문과 대조한 뒤 등록해 주세요.',
    ] };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (image) throw badRequest('사진을 읽지 못했습니다. 손상되지 않은 JPG·JPEG·PNG 사진을 다시 골라 주세요.');
    throw badRequest('문서를 읽지 못했습니다. 암호·손상 여부를 확인하고 PDF 또는 HWPX로 다시 저장해 주세요.');
  } finally { await rm(temp, { recursive: true, force: true }); }
}
