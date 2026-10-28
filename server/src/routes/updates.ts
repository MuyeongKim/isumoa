import type { FastifyInstance } from 'fastify';
import { currentUser, requireAdmin } from '../auth/guard.ts';
import type { Deps } from '../deps.ts';
import { createUpdateService } from '../updates/service.ts';
import { runBackup } from '../ops/backup.ts';
import { loadRetention } from '../ops/retention.ts';
import { audit } from '../lib/audit.ts';
import { badRequest } from '../lib/errors.ts';

export async function updateRoutes(app:FastifyInstance,deps:Deps){
 const {db,config,version}=deps,updates=createUpdateService(config,version,deps.updateRuntime);
 const local=async(req:import('fastify').FastifyRequest)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.ip))throw badRequest('설치 업데이트는 이 PC에서만 실행할 수 있습니다.');};
 app.get('/api/system/update',{preHandler:requireAdmin},async()=>updates.status());
 app.post('/api/system/update/check',{preHandler:requireAdmin},async()=>updates.check());
 app.post('/api/system/update/download',{preHandler:[requireAdmin,local]},async()=>updates.download());
 app.post('/api/system/update/file',{preHandler:[requireAdmin,local]},async req=>{const part=await req.file({limits:{fileSize:300*1024*1024}});if(!part)throw badRequest('설치 EXE를 골라 주세요.');const field=part.fields.sha256;const sha=field&&!Array.isArray(field)&&field.type==='field'?String(field.value):'';let result;try{result=await updates.upload(part.file,part.filename,sha);}finally{part.file.resume();}if(part.file.truncated)throw badRequest('설치 파일이 너무 큽니다.');return result;});
 app.post('/api/system/update/install',{preHandler:[requireAdmin,local]},async req=>updates.install(async()=>{const jobs=await db.selectFrom('jobs').select(eb=>eb.fn.countAll<number>().as('n')).where('state','in',['queued','running']).executeTakeFirstOrThrow();if(Number(jobs.n))throw badRequest('수료증 읽기 작업이 끝난 뒤 업데이트해 주세요.');const backup=await runBackup(db,config,(await loadRetention(db)).backupKeep);if(!backup.ok)throw badRequest(`백업에 실패해 업데이트를 중단했습니다. ${backup.error}`);await audit(db,req,'system.update',undefined,{version:updates.status().preparedVersion??'설치파일',user:currentUser(req).loginId});}));
}
