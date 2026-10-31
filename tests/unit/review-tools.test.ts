import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRulePack, canonical } from '../../server/src/rules/schema.ts';
import { verifyOfficial, defaultRules, emptyCustom } from '../../server/src/rules/service.ts';
import { localEndpoint, requestLocal, listLocalModels, assertLocalModel, reviewWithLocal, DEFAULT_AI, type LocalTransport } from '../../server/src/assist/localAi.ts';
import { privateText, validateAiReply } from '../../server/src/assist/review.ts';
import { parseCertificateText } from '../../server/src/certs/parseText.ts';
import { classifyTrainings, trainingScopeConflict } from '../../server/src/certs/trainingClassifier.ts';
import type { RuleBundle, RulePack } from '../../shared/reviewTools.ts';
import type { CertificateInput, Training } from '../../shared/types.ts';
const rule={id:'test',title:'가상 윤리 과정',enabled:true,courseTitles:['공공윤리 실천'],keywords:[],excludeKeywords:[],providers:['가상교육원'],fromYear:2026,toYear:2026,trainingCode:'integrity',referenceHours:2};
const pack:RulePack={...emptyCustom,version:'user-test',rules:[rule]};
const bundle:RuleBundle={official:defaultRules,custom:pack,version:'test'};
it('규칙 JSON은 실행 코드·알 수 없는 키·공통 검색어·중복 ID를 거부한다',()=>{
 for(const changed of[{...pack,script:'process.exit()'},{...pack,rules:[{...rule,regex:'.*'}]},{...pack,rules:[{...rule,keywords:['정보']}]},{...pack,rules:[rule,rule]},{...pack,schemaVersion:2}])expect(()=>parseRulePack(changed)).toThrow();
});
it('기본 항목 이름을 생년월일에서 이수일 등으로 바꾸거나 중복 연결하지 못한다',()=>{
 expect(()=>parseRulePack({...pack,fieldAliases:{completed:['생년월일']}})).toThrow();expect(()=>parseRulePack({...pack,fieldAliases:{completed:['수강날짜'],birth:['수강날짜']}})).toThrow();
});
it('별도 이름을 날짜·과정·시간으로 읽되 기본 판독을 유지하고 확인 표시를 남긴다',()=>{
 const text='수료증\n성명 : 홍길동\n학습주제 : 공공윤리 실천\n수강완료일 : 2026-10-20\n수강인정량 : 2시간';const p=parseCertificateText(text,{course:['학습주제'],completed:['수강완료일'],hours:['수강인정량']});expect(p).toMatchObject({courseTitle:'공공윤리 실천',completedOn:'2026-10-20',hours:2});expect(p.notes.some(n=>n.code==='field-alias-match')).toBe(true);
});
it('공식 서명을 검증하며 내용·체크섬·서명 변조를 거부한다',()=>{
 const e=JSON.parse(readFileSync(new URL('../fixtures/official-rules-signed.json',import.meta.url),'utf8'));expect(verifyOfficial(e).pack.version).toBe('2026.10.31.2');for(const bad of[{...e,pack:{...e.pack,name:'변조'}},{...e,sha256:'0'.repeat(64)},{...e,signature:Buffer.alloc(64).toString('base64')},{...e,extra:true}])expect(()=>verifyOfficial(bad)).toThrow();expect(canonical({b:2,a:1})).toBe(canonical({a:1,b:2}));
});
it('사용자 규칙은 기관·연도·제외어를 대조하고 주제 충돌은 우회하지 못한다',()=>{
 const trainings=[{id:1,code:'integrity',name:'청렴교육',keywords:[],applicable:true},{id:2,code:'information-disclosure',name:'정보공개교육',keywords:[],applicable:true}];expect(classifyTrainings('공공윤리 실천','공공윤리 실천',trainings,new Map(),{provider:'가상교육원',year:2026,rules:bundle}).trainingIds).toEqual([1]);expect(classifyTrainings('공공윤리 실천','공공윤리 실천',trainings,new Map(),{provider:'다른기관',year:2026,rules:bundle}).trainingIds).toEqual([]);expect(classifyTrainings('공공윤리 실천','공공윤리 실천',trainings,new Map(),{provider:'가상교육원',year:2027,rules:bundle}).trainingIds).toEqual([]);expect(trainingScopeConflict('정보보안 실무',{code:'information-disclosure',name:'이름을 바꾼 교육'})).toBeTruthy();
 const unsafe={...bundle,custom:{...pack,rules:[{...rule,courseTitles:['정보보안 실무'],trainingCode:'information-disclosure'}]}};expect(classifyTrainings('정보보안 실무','정보보안 실무',trainings,new Map(),{provider:'가상교육원',year:2026,rules:unsafe}).trainingIds).toEqual([]);
});
it('LLM 주소는 DNS·외부·내부망·사용자정보·임의경로·다른프로토콜을 허용하지 않는다',()=>{
 for(const url of['https://example.com','http://192.168.1.3:11434','http://127.0.0.1.evil.test','http://127.0.0.1@evil.test','http://127.0.0.1:11434/path','file:///tmp/model','http://127.0.0.1:11434?x=y'])expect(()=>localEndpoint(url)).toThrow();expect(localEndpoint('http://localhost:11434').host).toBe('127.0.0.1');expect(localEndpoint('http://[::1]:11434').host).toBe('::1');
});
const safeModel={name:'local-test:latest',size:2000000,digest:'a'.repeat(64),details:{format:'gguf'}};
const goodShow={details:{format:'gguf'},modelfile:'FROM /tmp/models/blobs/sha256-'+'a'.repeat(64),capabilities:['completion']};
it('클라우드·원격 별칭·임베딩 전용 모델은 검토 전에 차단한다',async()=>{
 const calls:string[]=[];const t:LocalTransport=async(_,path)=>{calls.push(path);if(path==='/api/tags')return {models:[safeModel,{...safeModel,name:'hidden',remote_host:'https://ollama.com'},{...safeModel,name:'x:cloud'},{...safeModel,name:'bge-m3:latest'}]};return {...goodShow,remote_model:'remote'};};expect((await listLocalModels(DEFAULT_AI,t)).models).toHaveLength(1);await expect(assertLocalModel({...DEFAULT_AI,model:safeModel.name},t)).rejects.toThrow();expect(calls).not.toContain('/api/chat');
});
it('LLM을 꺼두면 네트워크 호출 없이 규칙 검수로 남는다',async()=>{let calls=0;await expect(reviewWithLocal(DEFAULT_AI,[],{},async()=>{calls++;return{}})).rejects.toThrow('꺼져');expect(calls).toBe(0);});
it('개인 식별값·번호·연락처는 원문 전달 전에 가린다',()=>{const result=privateText('성명 : 홍 길 동\n생년월일 : 1981-03-02\n과정명 : 공공윤리\n연락처 010-1234-5678\na@example.com\n123456-1234567',['홍길동','1981-03-02']);expect(result).not.toContain('홍 길 동');expect(result).not.toContain('1981-03-02');expect(result).not.toContain('010-1234-5678');expect(result).not.toContain('a@example.com');expect(result).not.toContain('1234567');expect(result).toContain('공공윤리');});
const trainings=[{id:1,code:'integrity',name:'청렴교육',active:true,deletedAt:null,fromYear:null,toYear:null},{id:2,code:'information-disclosure',name:'정보공개교육',active:true,deletedAt:null,fromYear:null,toYear:null}] as Training[];
const input:CertificateInput={employeeId:1,courseTitle:'정보보안 실무',provider:'가상교육원',certNo:'T-1',completedOn:'2026-10-19',hours:3,year:2026,credits:[]};
it('근거 없는 숫자·차시 환산·알 수 없는 교육·주제 충돌을 제안에서 제외한다',()=>{const text='과정명 : 정보보안 실무\n이수일 : 2026-10-20\n교육시간 : 2차시';const suggestions=[{field:'hours',value:2,reason:'추정',evidence:'2차시'},{field:'trainingCodes',value:['information-disclosure'],reason:'추정',evidence:'정보보안 실무'},{field:'completedOn',value:'2026-10-20',reason:'명시된 날짜',evidence:'이수일 : 2026-10-20'}];const r=validateAiReply({summary:'비교하세요',suggestions},input,text,trainings,bundle);expect(r.suggestions).toEqual([suggestions[2]]);expect(r.rejected).toBe(2);expect(()=>validateAiReply({summary:'x',suggestions:[],autoConfirm:true},input,text,trainings,bundle)).toThrow();});
let server:ReturnType<typeof createServer>,endpoint:string;
beforeAll(async()=>{server=createServer((req,res)=>{if(req.url==='/redirect'){res.writeHead(302,{location:'http://example.com'});res.end();}else if(req.url==='/slow'){}else{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}))}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('No test address');endpoint='http://127.0.0.1:'+address.port;});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
it('실제 로컬 HTTP 요청에서 리디렉션을 따르지 않고 총 대기 시간을 제한한다',async()=>{expect(await requestLocal(endpoint,'/ok',null,1000)).toEqual({ok:true});await expect(requestLocal(endpoint,'/redirect',null,1000)).rejects.toThrow('302');await expect(requestLocal(endpoint,'/slow',null,40)).rejects.toThrow('시간');});
