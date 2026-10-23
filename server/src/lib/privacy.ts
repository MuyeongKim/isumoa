import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { getSetting, setSetting } from '../db/seed.ts';

// 주민등록번호는 저장하지 않는다. 이수증에 "주민등록번호 850312-1234567"이 찍혀 있어도
// PDF 글자층·OCR 결과를 저장하기 전에 뒷자리를 가린다 (850312-1******).
// 생년월일(앞 6자리)과 성별 자리는 직원 확인에 쓰여 남긴다. 쪽 이미지에는 그대로 보이므로 화면에서만 다룬다.

const RRN = /(?<![0-9])(\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]))\s*[-–]\s*([1-8])\s*\d{6}(?![0-9])/g;

export function maskRrn(text: string): string;
export function maskRrn(text: string | null): string | null;
export function maskRrn(text: string | null): string | null {
  return text === null ? null : text.replace(RRN, '$1-$2******');
}

/** 이 기능 이전에 저장된 글자도 한 번 가린다 */
export async function maskStoredRrn(db: Kysely<DB>): Promise<number> {
  if (await getSetting(db, 'rrnMasked', false)) return 0;
  let changed = 0;
  const rows = await db
    .selectFrom('pages')
    .select(['id', 'text_layer', 'ocr_text'])
    .where((eb) => eb.or([eb('text_layer', 'like', '%-%'), eb('ocr_text', 'like', '%-%')]))
    .execute();
  for (const r of rows) {
    const next = { text_layer: maskRrn(r.text_layer), ocr_text: maskRrn(r.ocr_text) };
    if (next.text_layer !== r.text_layer || next.ocr_text !== r.ocr_text) {
      await db.updateTable('pages').set(next).where('id', '=', r.id).execute();
      changed++;
    }
  }
  await setSetting(db, 'rrnMasked', true);
  return changed;
}
