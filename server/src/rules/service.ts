import { createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import { APP_ROOT } from '../config.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { badRequest, HttpError } from '../lib/errors.ts';
import { canonical, compareVersions, parseRulePack } from './schema.ts';
import { mergedAliases } from '../../../shared/reviewTools.ts';
import type { OfficialRuleEnvelope, RuleChange, RulePack, RulePreview, RuleState } from '../../../shared/reviewTools.ts';

export const OFFICIAL_RULE_URL='https://raw.githubusercontent.com/MuyeongKim/isumoa-releases/main/rules/latest.json';
export const defaultRules=parseRulePack(JSON.parse(readFileSync(join(APP_ROOT,'shared/defaultRules.json'),'utf8')));
export const emptyCustom:RulePack={schemaVersion:1,version:'user-0',minimumAppVersion:'0.5.8',name:'내 사용자 규칙',rules:[],fieldAliases:{}};
const currentApp=JSON.parse(readFileSync(join(APP_ROOT,'package.json'),'utf8')).version as string;
export const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const stateCache=new WeakMap<Kysely<DB>,RuleState>();
export async function loadRuleState(db:Kysely<DB>):Promise<RuleState>{const revision=await getSetting(db,'reviewRulesRevision',0),cached=stateCache.get(db);if(cached&&cached.revision===revision)return cached;const saved=await getSetting<Omit<RuleState,'version'>|null>(db,'reviewRules',null);const s=saved??{revision:0,official:defaultRules,custom:emptyCustom,history:[]};const state={...s,version:s.official.version+'/'+s.custom.version+'#'+s.revision};stateCache.set(db,state);return state;}

function compatible(pack:RulePack){if(compareVersions(pack.minimumAppVersion,currentApp)>0)throw badRequest(`이 규칙은 프로그램 ${pack.minimumAppVersion} 이상에서 사용할 수 있습니다. 프로그램을 먼저 업데이트하세요.`);}
export function verifyOfficial(value:unknown):OfficialRuleEnvelope{
 if(!value||typeof value!=='object'||Array.isArray(value))throw badRequest('공식 규칙 파일 형식을 확인하세요.');
 const e=value as OfficialRuleEnvelope;const keys=Object.keys(e).sort().join(',');if(keys!=='pack,sha256,signature')throw badRequest('공식 규칙 파일에 알 수 없는 항목이 있습니다.');
 const pack=parseRulePack(e.pack);const data=canonical(pack);if(typeof e.sha256!=='string'||sha256(data)!==e.sha256||typeof e.signature!=='string')throw badRequest('공식 규칙 체크섬을 확인하지 못했습니다.');
 const publicKey=readFileSync(join(APP_ROOT,'shared/rules-public.pem'),'utf8');let ok=false;try{ok=verify(null,Buffer.from(data),publicKey,Buffer.from(e.signature,'base64'))}catch{}if(!ok)throw badRequest('공식 규칙 서명을 확인하지 못했습니다. 기존 규칙을 유지합니다.');compatible(pack);return {pack,sha256:e.sha256,signature:e.signature};
}
export function changes(old:RulePack,next:RulePack):RuleChange{const a=new Map(old.rules.map(r=>[r.id,r])),b=new Map(next.rules.map(r=>[r.id,r]));return {added:next.rules.filter(r=>!a.has(r.id)).map(r=>r.title),changed:next.rules.filter(r=>a.has(r.id)&&canonical(a.get(r.id))!==canonical(r)).map(r=>r.title),removed:old.rules.filter(r=>!b.has(r.id)).map(r=>r.title),aliasesChanged:canonical(old.fieldAliases)!==canonical(next.fieldAliases)};}
function token(s:RuleState,kind:string,pack:RulePack){return sha256(canonical({revision:s.revision,kind,pack}));}
export async function previewRules(db:Kysely<DB>,value:unknown,kind:'custom'|'official',mode:'merge'|'replace'='merge'):Promise<RulePreview>{
 const s=await loadRuleState(db);let pack=kind==='official'?verifyOfficial(value).pack:parseRulePack(value);compatible(pack);if(kind==='official'){if(!/^\d{4}\.\d{1,2}\.\d{1,2}\.\d+$/.test(pack.version)||compareVersions(pack.version,s.official.version)<0)throw badRequest('이전 공식 규칙입니다. 복원은 적용 이력에서 선택하세요.');if(pack.version===s.official.version&&canonical(pack)!==canonical(s.official))throw badRequest('공식 규칙의 버전과 내용이 일치하지 않습니다.');}
 if(kind==='custom'){
  const targets=await db.selectFrom('trainings').select('code').where('deleted_at','is',null).execute();const codes=new Set(targets.map(t=>t.code));const unknown=pack.rules.filter(r=>!codes.has(r.trainingCode));if(unknown.length)throw badRequest('교육 기준에 없는 연결 코드: '+[...new Set(unknown.map(r=>r.trainingCode))].join(', ')+'. 규칙 편집 화면에서 연결할 교육을 먼저 선택해 주세요.');
  if(mode==='merge'){const rules=new Map(s.custom.rules.map(r=>[r.id,r]));for(const r of pack.rules)rules.set(r.id,r);const fieldAliases={...s.custom.fieldAliases};for(const[k,v]of Object.entries(pack.fieldAliases))fieldAliases[k as keyof typeof fieldAliases]=[...new Set([...(fieldAliases[k as keyof typeof fieldAliases]??[]),...(v??[])])];pack=parseRulePack({...pack,rules:[...rules.values()],fieldAliases});}
 }
 parseRulePack({...pack,rules:[],fieldAliases:mergedAliases({...s,[kind]:pack})});
 return {pack,kind,revision:s.revision,version:pack.version,changes:changes(s[kind],pack),token:token(s,kind,pack)};
}
export async function applyRules(db:Kysely<DB>,preview:RulePreview,envelope?:unknown){return db.transaction().execute(async trx=>{
 const s=await loadRuleState(trx);const activeJobs=await trx.selectFrom('jobs').select(eb=>eb.fn.countAll<number>().as('n')).where('state','in',['queued','running']).executeTakeFirstOrThrow();if(Number(activeJobs.n))throw badRequest('수료증 읽기가 끝난 뒤 규칙을 적용하세요.');const pack=parseRulePack(preview.pack);compatible(pack);if(preview.kind==='official'){if(compareVersions(pack.version,s.official.version)<0)throw badRequest('이전 버전은 복원 이력에서 선택하세요.');if(pack.version===s.official.version&&canonical(pack)!==canonical(s.official))throw badRequest('동일한 공식 버전의 내용이 달라 적용하지 않았습니다.');const official=verifyOfficial(envelope);if(canonical(official.pack)!==canonical(pack))throw badRequest('공식 규칙 내용이 변경됐습니다.');}
 if(preview.kind==='custom'){const targets=await trx.selectFrom('trainings').select('code').where('deleted_at','is',null).execute();if(pack.rules.some(r=>!targets.some(t=>t.code===r.trainingCode)))throw badRequest('연결할 교육 기준이 변경됐습니다. 다시 미리보기하세요.');}parseRulePack({...pack,rules:[],fieldAliases:mergedAliases({...s,[preview.kind]:pack})});
 if(!['official','custom'].includes(preview.kind)||preview.revision!==s.revision||preview.token!==token(s,preview.kind,pack))throw new HttpError(409,'미리보기 후 규칙이 변경됐습니다. 다시 확인해 주세요.');
 const next={revision:s.revision+1,official:preview.kind==='official'?pack:s.official,custom:preview.kind==='custom'?pack:s.custom,history:[{revision:s.revision,at:new Date().toISOString(),label:preview.kind==='official'?'공식 규칙 변경 전':'사용자 규칙 변경 전',official:s.official,custom:s.custom},...s.history].slice(0,10)};
 await setSetting(trx,'reviewRules',next);await setSetting(trx,'reviewRulesRevision',next.revision);return {...next,version:next.official.version+'/'+next.custom.version+'#'+next.revision};
 });}
export async function restoreRules(db:Kysely<DB>,revision:number,currentRevision:number){return db.transaction().execute(async trx=>{const s=await loadRuleState(trx);if(s.revision!==currentRevision)throw new HttpError(409,'규칙이 변경됐습니다. 목록을 새로 불러오세요.');const jobs=await trx.selectFrom('jobs').select(eb=>eb.fn.countAll<number>().as('n')).where('state','in',['queued','running']).executeTakeFirstOrThrow();if(Number(jobs.n))throw badRequest('수료증 읽기가 끝난 뒤 규칙을 복원하세요.');const chosen=s.history.find(h=>h.revision===revision);if(!chosen)throw badRequest('복원할 규칙 이력을 찾지 못했습니다.');const next={revision:s.revision+1,official:chosen.official,custom:chosen.custom,history:[{revision:s.revision,at:new Date().toISOString(),label:'복원 전',official:s.official,custom:s.custom},...s.history].slice(0,10)};await setSetting(trx,'reviewRules',next);await setSetting(trx,'reviewRulesRevision',next.revision);return next;});}
export async function checkOfficial(db:Kysely<DB>){const response=await fetch(OFFICIAL_RULE_URL,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw badRequest('공식 규칙을 받지 못했습니다. 파일 가져오기도 사용할 수 있습니다.');let size=0;const chunks:Uint8Array[]=[];if(!response.body)throw badRequest('공식 규칙 응답이 비었습니다.');for await(const b of response.body){size+=b.length;if(size>2*1024*1024){await response.body.cancel().catch(()=>{});throw badRequest('공식 규칙 파일이 너무 큽니다.')}chunks.push(b)}let parsed:unknown;try{parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw badRequest('공식 규칙 JSON을 읽지 못했습니다.')}const envelope=verifyOfficial(parsed),s=await loadRuleState(db);return {available:canonical(envelope.pack)!==canonical(s.official),envelope,preview:await previewRules(db,envelope,'official')};}
