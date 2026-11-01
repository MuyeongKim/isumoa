import { afterEach, beforeEach, expect, it } from 'vitest';
import { seedDefaults } from '../../server/src/db/seed.ts';
import { createHarness, PDF, type Harness } from './harness.ts';
import type { BulkExcludePreview, CertificateDetail, CertificateListItem } from '../../shared/types.ts';
let h:Harness,department:number,employee:number,batch:number;
const full='2026년 폭력예방 통합교육(성희롱·성매매·성폭력·가정폭력)';
beforeEach(async()=>{h=await createHarness();await h.db.deleteFrom('course_mappings').execute();await h.db.deleteFrom('trainings').execute();await seedDefaults(h.db);department=(await h.send('POST','/api/departments',{name:'가상부서'})).json().id;employee=(await h.send('POST','/api/employees',{name:'홍길동',departmentId:department})).json().id;batch=(await h.send('POST','/api/batches',{year:2026,title:'고도화 검증'})).json().id;});
afterEach(async()=>{await h.close();});
async function page(title:string,memo=false){const file=(await h.uploadFile(batch,Buffer.concat([PDF,Buffer.from(title+Math.random())]),title+'.pdf')).json().fileId;await h.uploadPage(file,1,memo?'업무 메모\n자료 목록\n표지입니다.':`수 료 증\n성명: 홍길동\n소속: 가상부서\n과정명: ${title}\n교육기간: 2026.04.01.~2026.04.01.\n교육시간: 4시간\n제 FAKE-${file} 호\n위 사람은 교육과정을 이수하였기에 이 증서를 수여합니다.\n가상연수원장`);expect(await h.drainQueue()).toEqual([]);return (await h.db.selectFrom('certificates').select('id').orderBy('id','desc').executeTakeFirstOrThrow()).id;}
async function preview(ids:number[],onlyNonCertificates=true){return h.send('POST','/api/certificates/bulk-exclude-preview',{ids,onlyNonCertificates});}
async function apply(p:BulkExcludePreview,onlyNonCertificates=true){return h.send('POST','/api/certificates/bulk-exclude',{ids:p.ids,token:p.token,reason:'임의 사유',onlyNonCertificates});}
it('4대 전체 과정은 정상 일괄 확정하고 애매한 과정명은 남긴다',async()=>{
 const id=await page(full);const list=(await h.send('GET','/api/certificates')).json() as CertificateListItem[];expect(list[0].flags.every(f=>f.level==='info')).toBe(true);
 const result=await h.send('POST','/api/certificates/bulk-confirm',{ids:[id]});expect(result.statusCode).toBe(200);expect(result.json().confirmed).toBe(1);
 const ambiguous=await page('폭력예방 교육');const d=(await h.send('GET',`/api/certificates/${ambiguous}`)).json() as CertificateDetail;expect(d.flags.some(f=>f.code==='training-name-suggestion')).toBe(true);expect((await h.send('POST','/api/certificates/bulk-confirm',{ids:[ambiguous]})).json().confirmed).toBe(0);
});
it('저장된 대기 경고만 읽을 때 재평가하고 notes·수정값·확정 기록은 쓰지 않는다',async()=>{
 const id=await page(full);const notes=JSON.stringify([{code:'training-name-suggestion',level:'warning',message:'이전 이름 비교'}]);await h.db.updateTable('certificates').set({notes,flags:notes}).where('id','=',id).execute();
 const before=await h.db.selectFrom('certificates').selectAll().execute();const credits=await h.db.selectFrom('certificate_trainings').selectAll().execute();
 expect((await h.send('GET','/api/certificates')).json()[0].flags).toEqual([]);expect((await h.send('GET',`/api/certificates/${id}`)).json().flags).toEqual([]);
 expect(await h.db.selectFrom('certificates').selectAll().execute()).toEqual(before);expect(await h.db.selectFrom('certificate_trainings').selectAll().execute()).toEqual(credits);
 expect((await h.send('POST','/api/certificates/bulk-confirm',{ids:[id]})).json().confirmed).toBe(1);
 const confirmed=await h.db.selectFrom('certificates').selectAll().execute();await h.send('GET','/api/certificates');expect(await h.db.selectFrom('certificates').selectAll().execute()).toEqual(confirmed);
});
it('선택한 이수증 아닌 대기 쪽만 제외하고 감사 로그·복원을 제공한다',async()=>{
 const memo=await page('표지',true),other=await page('메모',true),cert=await page(full);const p=(await preview([memo])).json() as BulkExcludePreview;expect((await apply(p)).statusCode).toBe(200);
 const rows=await h.db.selectFrom('certificates').selectAll().orderBy('id').execute();expect(rows.find(r=>r.id===memo)).toMatchObject({status:'excluded',exclude_reason:'이수증 아님'});for(const id of [other,cert])expect(rows.find(r=>r.id===id)?.status).toBe('draft');
 const logs=await h.db.selectFrom('audit_log').select(['action','detail']).where('target_id','=',String(memo)).execute();expect(logs).toContainEqual(expect.objectContaining({action:'certificate.exclude',detail:expect.stringContaining('이수증 아님')}));expect(await h.db.selectFrom('audit_log').select('id').where('action','=','certificate.bulk-exclude').executeTakeFirst()).toBeDefined();
 expect((await h.send('POST',`/api/certificates/${memo}/reopen`)).json().status).toBe('draft');
});
it('확정·정상·읽는 중·조건이 바뀐 자료나 모드를 바꾼 토큰은 하나도 제외하지 않는다',async()=>{
 const memo=await page('표지',true),cert=await page(full);expect((await preview([memo,cert])).statusCode).toBe(409);
 const generic=(await preview([memo],false)).json() as BulkExcludePreview;expect((await apply(generic)).statusCode).toBe(409);
 const p=(await preview([memo])).json() as BulkExcludePreview;
 await h.db.updateTable('certificates').set({status:'confirmed'}).where('id','=',memo).execute();expect((await apply(p)).statusCode).toBe(409);expect((await preview([memo])).statusCode).toBe(409);
 await h.db.updateTable('certificates').set({status:'draft'}).where('id','=',memo).execute();const pageId=(await h.db.selectFrom('certificates').select('page_id').where('id','=',memo).executeTakeFirstOrThrow()).page_id;
 await h.db.updateTable('pages').set({state:'processing'}).where('id','=',pageId).execute();expect((await apply(p)).statusCode).toBe(409);
 await h.db.updateTable('pages').set({state:'done',text_layer:'수료증\n성명: 홍길동\n과정명: 청렴교육\n이수일: 2026.04.01.\n교육시간: 1시간\n위 사람은 교육과정을 이수하였기에 이 증서를 수여합니다.'}).where('id','=',pageId).execute();expect((await preview([memo])).statusCode).toBe(409);expect((await apply(p)).statusCode).toBe(409);
 expect((await h.db.selectFrom('certificates').select('status').execute()).every(r=>r.status==='draft')).toBe(true);
});
it('자기 업로드라도 다른 부서 직원에 연결된 자료는 특별 일괄 제외하지 못한다',async()=>{
 const memo=await page('표지',true);await h.db.updateTable('certificates').set({employee_id:employee}).where('id','=',memo).execute();
 const other=(await h.send('POST','/api/departments',{name:'다른부서'})).json().id;await h.send('POST','/api/users',{loginId:'clerk',name:'가상서무',role:'clerk',password:'Clerk1234!',departmentIds:[other]});const clerk=await h.db.selectFrom('users').select('id').where('login_id','=','clerk').executeTakeFirstOrThrow();await h.db.updateTable('users').set({must_change_password:0}).where('id','=',clerk.id).execute();await h.db.updateTable('batches').set({created_by:clerk.id}).where('id','=',batch).execute();
 const p=(await preview([memo])).json() as BulkExcludePreview;const login=await h.app.inject({method:'POST',url:'/api/auth/login',payload:{loginId:'clerk',password:'Clerk1234!'},headers:{'x-requested-with':'fetch'}});const headers={'x-requested-with':'fetch',cookie:`ecp_sid=${login.cookies.find(c=>c.name==='ecp_sid')!.value}`};
 for(const [url,payload] of [['/api/certificates/bulk-exclude-preview',{ids:[memo],onlyNonCertificates:true}],['/api/certificates/bulk-exclude',{ids:[memo],onlyNonCertificates:true,token:p.token,reason:'이수증 아님'}]] as const)expect((await h.app.inject({method:'POST',url,payload,headers})).statusCode).toBe(403);
 expect((await h.db.selectFrom('certificates').select('status').where('id','=',memo).executeTakeFirstOrThrow()).status).toBe('draft');
});
it('연도 뒤 4대 표기의 기존 대기는 목록·상세에서 파생 경고를 재평가하고 저장 기록은 보존한다',async()=>{
 const id=await page('2026 4대폭력 예방교육');
 const notes=JSON.stringify([{code:'training-name-suggestion',level:'warning',message:'이전 이름 비교'}]);
 const flags=JSON.stringify([...JSON.parse(notes),{code:'training-integrated-check',level:'warning',message:'이전 전체 범위 확인'}]);
 await h.db.updateTable('certificates').set({notes,flags}).where('id','=',id).execute();
 const before=await h.db.selectFrom('certificates').selectAll().execute();const credits=await h.db.selectFrom('certificate_trainings').selectAll().execute();
 const list=(await h.send('GET','/api/certificates')).json() as CertificateListItem[];const detail=(await h.send('GET',`/api/certificates/${id}`)).json() as CertificateDetail;
 for(const item of [list.find(c=>c.id===id)!,detail]){expect(item.flags.map(f=>f.code)).not.toContain('training-name-suggestion');expect(item.flags.map(f=>f.code)).not.toContain('training-integrated-check');expect(item.flags.every(f=>f.level==='info')).toBe(true);}
 expect(await h.db.selectFrom('certificates').selectAll().execute()).toEqual(before);expect(await h.db.selectFrom('certificate_trainings').selectAll().execute()).toEqual(credits);
});
