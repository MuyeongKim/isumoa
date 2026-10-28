import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';

// 읽은 텍스트에서는 주민등록번호 뒷자리를 가린다. 하이픈 생략·OCR 공백도 처리한다.
// PDF 글자층·OCR 결과를 저장하기 전에 뒷자리를 가린다 (850312-1******).
// 생년월일·세기 구분 자리는 직원 확인에 남긴다. 원본 PDF·사진·쪽 이미지는 이 함수가 수정하지 않는다.

const RRN = /(?<![0-9])(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))\s*[-–]?\s*([1-8])(?:[ \t]*\d){6}(?![0-9])/g;

export function maskRrn(text: string): string;
export function maskRrn(text: string | null): string | null;
export function maskRrn(text: string | null): string | null {
  return text === null ? null : text.replace(RRN, '$1-$2******');
}

/** 이 기능 이전에 저장된 글자도 한 번 가린다 */
export async function maskStoredRrn(db: Kysely<DB>): Promise<number> {
  if (await getSetting(db, 'rrnMaskedV2', false)) return 0;
  let changed = 0;
  let afterId = 0;
  for (;;) {
    const rows = await db.selectFrom('pages').select(['id', 'text_layer', 'ocr_text'])
      .where('id', '>', afterId).orderBy('id').limit(100).execute();
    if (!rows.length) break;
    for (const r of rows) {
      const next = { text_layer: maskRrn(r.text_layer), ocr_text: maskRrn(r.ocr_text) };
      if (next.text_layer !== r.text_layer || next.ocr_text !== r.ocr_text) {
        await db.updateTable('pages').set(next).where('id', '=', r.id).execute();
        changed++;
      }
    }
    afterId = rows.at(-1)!.id;
  }
  await setSetting(db, 'rrnMaskedV2', true);
  return changed;
}
