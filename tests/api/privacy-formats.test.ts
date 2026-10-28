import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, PDF, type Harness } from './harness.ts';
import { maskStoredRrn } from '../../server/src/lib/privacy.ts';
import { setSetting } from '../../server/src/db/seed.ts';
let h: Harness | undefined;
afterEach(async () => { if(h) await h.close(); h=undefined; });
describe('읽은 텍스트의 개인정보 보호', () => {
  it('신규 업로드와 이전 마스킹 완료 자료에 하이픈 없는 주민번호도 가린다', async () => {
    h=await createHarness();
    const batch=(await h.send('POST','/api/batches',{year:2026})).json().id;
    const file=(await h.uploadFile(batch,PDF,'가상개인정보.pdf')).json().fileId;
    const id=await h.uploadPage(file,1,'주민번호 8503121234567');
    let row=await h.db.selectFrom('pages').selectAll().where('id','=',id).executeTakeFirstOrThrow();
    expect(row.text_layer).toContain('850312-1******');
    await h.db.updateTable('pages').set({text_layer:'주민번호 8503121234567',ocr_text:'850312 1 2 3 4 5 6 7'}).where('id','=',id).execute();
    await setSetting(h.db,'rrnMasked',true);
    expect(await maskStoredRrn(h.db)).toBe(1);
    row=await h.db.selectFrom('pages').selectAll().where('id','=',id).executeTakeFirstOrThrow();
    expect(row.text_layer).toBe('주민번호 850312-1******');
    expect(row.ocr_text).toBe('850312-1******');
    expect(await maskStoredRrn(h.db)).toBe(0);
  });
});
