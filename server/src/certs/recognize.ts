import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { maskRrn } from '../lib/privacy.ts';
import type { OcrEngine } from '../ocr/engine.ts';
import { pageImagePath } from '../storage.ts';
import { hasUsableText, parseCertificateText, type ParsedCertificate } from './parseText.ts';

// 쪽 하나에서 이수증 값을 읽는다. AI는 쓰지 않는다 — 모든 판독이 이 프로그램 안에서 끝난다.
//   1) 글자 확보: PDF 글자층이 쓸 만하면 그대로, 아니면 쪽 이미지를 OCR
//   2) 규칙 판독: "성명 : 홍길동"처럼 항목 이름과 값을 찾는다 (parseText.ts)

export interface RecognizeDeps {
  db: Kysely<DB>;
  dataDir: string;
  ocr: OcrEngine;
}

export interface PageForRecognition {
  id: number;
  file_id: number;
  page_no: number;
  text_layer: string | null;
  ocr_text: string | null;
  ocr_engine: string | null;
}

export type Route = 'text' | 'ocr';

export interface Recognition {
  route: Route;
  /** 쪽의 글자 (PDF 글자층 또는 OCR) */
  text: string;
  read: ParsedCertificate;
}

export async function recognizePage(deps: RecognizeDeps, page: PageForRecognition): Promise<Recognition> {
  if (hasUsableText(page.text_layer)) {
    const text = page.text_layer!;
    return { route: 'text', text, read: parseCertificateText(text) };
  }
  // 앞에서 같은 엔진으로 읽어 둔 결과가 있으면 다시 쓴다 (엔진이 바뀌었으면 새로 읽음)
  let text = page.ocr_text;
  if (text === null || page.ocr_engine !== deps.ocr.name) {
    text = maskRrn(await deps.ocr.recognize(pageImagePath(deps.dataDir, page.file_id, page.page_no, 'image')));
    await deps.db.updateTable('pages').set({ ocr_text: text, ocr_engine: deps.ocr.name }).where('id', '=', page.id).execute();
  }
  return { route: 'ocr', text, read: parseCertificateText(text) };
}
