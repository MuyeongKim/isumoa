import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.ts';
let h: Harness | undefined;
afterEach(async () => { if(h) await h.close(); h=undefined; });
describe('PC 요청 경계', () => {
  it('로그인 생략 모드에서도 외부 도메인의 재바인딩 요청을 차단한다', async () => {
    h=await createHarness({singleUser:true});
    const result=await h.app.inject({url:'/api/employees',headers:{host:'attacker.invalid'}});
    expect(result.statusCode).toBe(403);
  });
  it('직접 설치판은 로컬 주소만 허용하며 프록시 헤더 위조를 믿지 않는다', async () => {
    h=await createHarness({desktop:true});
    for(const host of ['attacker.invalid','localhost.attacker.invalid','127.0.0.1.attacker.invalid']) {
      expect((await h.send('GET','/api/meta',undefined,{host,'x-forwarded-host':'localhost'})).statusCode).toBe(403);
    }
    for(const host of ['localhost:47210','127.0.0.1:47210','[::1]:47210'])expect((await h.send('GET','/api/meta',undefined,{host})).statusCode).toBe(200);
  });
  it('전용 헤더가 있어도 다른 사이트의 변경 요청은 받지 않는다', async () => {
    h=await createHarness();
    for(const origin of ['https://attacker.invalid','null','http://localhost:9999'])expect((await h.send('POST','/api/departments',{name:'차단대상'},{host:'localhost:3000',origin})).statusCode).toBe(403);
    expect((await h.send('POST','/api/departments',{name:'허용대상'},{host:'localhost:3000',origin:'http://localhost:3000'})).statusCode).toBe(200);
    expect((await h.send('POST','/api/departments',{name:'위조요청'},{'sec-fetch-site':'cross-site'})).statusCode).toBe(403);
  });
  it('명시적으로 설정한 서버·신뢰 프록시 접속은 보존한다', async () => {
    h=await createHarness({host:'127.0.0.1',singleUser:true,trustProxy:true});
    expect((await h.send('GET','/api/meta',undefined,{host:'internal.example'})).statusCode).toBe(200);
  });
});
