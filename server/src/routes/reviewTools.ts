import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { currentUser, requireAdmin, requireUser } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { getSetting, setSetting } from '../db/seed.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, HttpError, notFound } from '../lib/errors.ts';
import { canViewCertificate, getCertificateRow, isReading, loadMatchables, loadTrainings, pageText, scopeOf } from '../certs/review.ts';
import { CertificateBody } from './certificates.ts';
import { applyRules, checkOfficial, changes, loadRuleState, previewRules, restoreRules, verifyOfficial } from '../rules/service.ts';
import { parseRulePack } from '../rules/schema.ts';
import { assertLocalModel, listLocalModels, loadLocalAi, LocalAiSchema, localEndpoint } from '../assist/localAi.ts';
import { AI_FORMAT, buildAiMessages, inputHash, privateText, reviewByRules, storeReview, validateAiReply } from '../assist/review.ts';
import { reviewWithLocal } from '../assist/localAi.ts';
import { contentDisposition } from '../lib/http.ts';
import type { RulePreview } from '../../../shared/reviewTools.ts';
const Id=z.object({id:z.coerce.number().int().positive()});
const PreviewBody=z.object({pack:z.unknown(),official:z.boolean().default(false),mode:z.enum(['merge','replace']).default('merge'),expectedRevision:z.number().int().optional()}).strict();
const ApplyBody=z.object({preview:z.object({pack:z.unknown(),kind:z.enum(['custom','official']),revision:z.number().int(),token:z.string().regex(/^[a-f0-9]{64}$/)}),envelope:z.unknown().optional()});
export async function reviewToolRoutes(app:FastifyInstance,deps:Deps){const{db}=deps;
 app.get('/api/review-tools/info',{preHandler:requireUser},async()=>{const rules=await loadRuleState(db),ai=await loadLocalAi(db);return {ruleVersion:rules.version,aiEnabled:ai.enabled,model:ai.enabled?ai.model:null};});
 app.get('/api/rules',{preHandler:requireAdmin},()=>loadRuleState(db));
 app.get('/api/rules/export',{preHandler:requireAdmin},async(req,reply)=>{const s=await loadRuleState(db),q=z.object({kind:z.enum(['json','md']).default('json')}).parse(req.query);reply.header('Content-Disposition',contentDisposition(q.kind==='json'?'규칙.json':'규칙.md','rules.'+q.kind));if(q.kind==='json')return reply.type('application/json; charset=utf-8').send(JSON.stringify(s.custom,null,2)+'\n');const text=['# 사용자 검수 규칙','',`버전: ${s.custom.version}`,`적용 이력: ${s.revision}`,'','규칙.json은 설정 > 검수 규칙에서 가져옵니다. 이 문서는 설명용입니다. 프로그램 코드·직원 정보·기존 확정 기록은 변경하지 않습니다.','',...s.custom.rules.flatMap(r=>[`## ${r.title}`,`- 사용: ${r.enabled?'예':'아니오'}`,`- 과정명: ${r.courseTitles.join(', ')||'없음'}`,`- 검색어: ${r.keywords.join(', ')||'없음'}`,`- 제외 검색어: ${r.excludeKeywords.join(', ')||'없음'}`,`- 기관: ${r.providers.join(', ')||'전체'}`,`- 교육 코드: ${r.trainingCode}`,''])].join('\n');return reply.type('text/markdown; charset=utf-8').send(text);});
 app.post('/api/rules/preview',{preHandler:requireAdmin},async req=>{const b=PreviewBody.parse(req.body),s=await loadRuleState(db);if(b.expectedRevision!==undefined&&s.revision!==b.expectedRevision)throw new HttpError(409,'편집 중 규칙이 바뀌었습니다. 내용을 보관하고 목록을 새로 확인하세요.');return previewRules(db,b.pack,b.official?'official':'custom',b.mode);});
 app.post('/api/rules/apply',{preHandler:requireAdmin},async req=>{const b=ApplyBody.parse(req.body),s=await loadRuleState(db),pack=parseRulePack(b.preview.pack);const jobs=await db.selectFrom('jobs').select(eb=>eb.fn.countAll<number>().as('n')).where('state','in',['queued','running']).executeTakeFirstOrThrow();if(Number(jobs.n))throw badRequest('수료증 읽기가 끝난 뒤 규칙을 적용하세요. 현재 자료는 변경하지 않았습니다.');const p:RulePreview={...b.preview,pack,version:pack.version,changes:changes(s[b.preview.kind],pack)};const result=await applyRules(db,p,b.envelope);await audit(db,req,'rules.apply',undefined,{kind:p.kind,version:pack.version,revision:result.revision,added:p.changes.added.length,changed:p.changes.changed.length,removed:p.changes.removed.length});return result;});
 app.post('/api/rules/restore',{preHandler:requireAdmin},async req=>{const b=z.object({revision:z.number().int().min(0),currentRevision:z.number().int().min(0)}).strict().parse(req.body);const jobs=await db.selectFrom('jobs').select(eb=>eb.fn.countAll<number>().as('n')).where('state','in',['queued','running']).executeTakeFirstOrThrow();if(Number(jobs.n))throw badRequest('수료증 읽기가 끝난 뒤 규칙을 복원하세요.');const result=await restoreRules(db,b.revision,b.currentRevision);await audit(db,req,'rules.restore',undefined,{revision:b.revision,newRevision:result.revision});return result;});
 app.post('/api/rules/check',{preHandler:requireAdmin},async req=>{const result=await (deps.ruleFetcher?deps.ruleFetcher():checkOfficial(db));const envelope=verifyOfficial(result.envelope);const state=await loadRuleState(db);const preview=await previewRules(db,envelope,'official');await audit(db,req,'rules.check',undefined,{version:envelope.pack.version});return {...result,envelope,preview,currentRevision:state.revision};});
 app.get('/api/local-ai',{preHandler:requireAdmin},()=>loadLocalAi(db));
 app.post('/api/local-ai/probe',{preHandler:requireAdmin},async req=>{const settings=LocalAiSchema.parse(req.body);localEndpoint(settings.endpoint);const models=await listLocalModels(settings,deps.localAiTransport);if(settings.model)await assertLocalModel(settings,deps.localAiTransport);await audit(db,req,'local-ai.probe',undefined,{models:models.models.length,excluded:models.excluded});return models;});
 app.put('/api/local-ai',{preHandler:requireAdmin},async req=>{const settings=LocalAiSchema.parse(req.body);localEndpoint(settings.endpoint);if(settings.enabled)await assertLocalModel(settings,deps.localAiTransport);await setSetting(db,'localReviewAi',settings);await audit(db,req,'local-ai.settings',undefined,{enabled:settings.enabled,model:settings.enabled?settings.model:null});return settings;});
 for(const kind of ['rules','local_llm'] as const)app.post('/api/certificates/:id/'+(kind==='rules'?'rules-review':'ai-review'),{preHandler:requireUser},async req=>{
  const{id}=Id.parse(req.params),user=currentUser(req),row=await getCertificateRow(db,id);if(!row)throw notFound('이수증을 찾지 못했습니다.');if(!await canViewCertificate(db,row,user))throw new HttpError(403,'볼 수 없는 이수증입니다.');if(row.status!=='draft'||isReading(row.page_state))throw new HttpError(409,'읽기가 끝난 검수 대기 자료에서 추가 검토할 수 있습니다. 확정·제외 기록은 변경하지 않습니다.');
  const input=z.object({input:CertificateBody}).strict().parse(req.body).input;const rules=await loadRuleState(db),trainings=await loadTrainings(db),text=pageText(row);let result;
  if(kind==='rules')result=reviewByRules(input,text,trainings,await loadMatchables(db),rules,scopeOf(user));else{
   const settings=await loadLocalAi(db);const redacted=privateText(text,[row.person_name,row.person_birth,row.person_dept]);if(redacted.trim().length<20)throw badRequest('개인정보를 가린 뒤 검토할 글자가 부족합니다. 원본을 직접 확인하세요.');
   const raw=await reviewWithLocal(settings,buildAiMessages(input,redacted,trainings,rules),AI_FORMAT,deps.localAiTransport);result={...validateAiReply(raw,input,redacted,trainings,rules),model:settings.model};
  }
  const current=await getCertificateRow(db,id);if(!current||current.status!=='draft'||current.updated_at!==row.updated_at||(await loadRuleState(db)).version!==rules.version)throw new HttpError(409,'검토 중 자료 또는 규칙이 변경됐습니다. 현재 입력을 유지하고 다시 요청하세요.');
  result=await storeReview(db,id,user.id,result);await audit(db,req,'certificate.assist',{type:'certificate',id},{kind,model:result.model,ruleVersion:result.ruleVersion,inputHash:inputHash(input),suggestions:result.suggestions.length,rejected:result.rejected});return result;
 });
}
