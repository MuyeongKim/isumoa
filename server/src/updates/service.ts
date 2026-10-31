import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, copyFileSync } from 'node:fs';
import { open, statfs } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { UPDATE_MANIFEST_URL, UPDATE_RELEASES_URL, compareVersions, parseUpdateRelease, type UpdateStatus } from '../../../shared/updateChannel.ts';
import { APP_ROOT, type AppConfig } from '../config.ts';
import { fileHash } from '../ops/backupAssets.ts';
import { badRequest } from '../lib/errors.ts';

async function releaseMetadata(response: Response): Promise<unknown> {
  if (!response.body) throw Error('업데이트 정보가 비어 있습니다.');
  const reader = response.body.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  try { for (;;) { const {done, value} = await reader.read(); if (done) break; bytes += value.length; if (bytes > 256 * 1024) throw Error('업데이트 정보가 허용 크기를 넘습니다.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface UpdateRuntime { platform?: string; fetch?: typeof fetch; launch?: (receipt: string) => Promise<void>; freeBytes?: () => Promise<number> }
export function updateDirectory(config: AppConfig): string { return join(config.dataDir,'updates'); }
export function updateLocked(config: AppConfig): boolean { return existsSync(join(updateDirectory(config),'install.lock')); }

/** 관리자가 누른 경우에만 배포 서버에 접속한다. 업무 자료와 GitHub 자격증명은 보내지 않는다. */
export function createUpdateService(config: AppConfig,currentVersion: string,runtime: UpdateRuntime={}) {
  const directory=updateDirectory(config),stateFile=join(directory,'status.json'),helper=join(APP_ROOT,'..','apply-update.ps1');
  const supported=(runtime.platform??process.platform)==='win32'&&config.desktop&&['127.0.0.1','::1','localhost'].includes(config.host)&&(!!runtime.launch||existsSync(helper));
  let state:UpdateStatus={currentVersion,supported,releasesUrl:UPDATE_RELEASES_URL,phase:'idle',latest:null,preparedVersion:null,downloadedBytes:0,error:null,checkedAt:null};
  if (existsSync(stateFile)) { try { const disk=JSON.parse(readFileSync(stateFile,'utf8')); if (['installing','completed','error'].includes(disk.phase)) state={...state,...disk,currentVersion,supported}; } catch {} }
  let ready:{path:string;version:string;sha256:string}|null=null;let busy=false;
  const save=()=>{mkdirSync(directory,{recursive:true});writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));renameSync(stateFile+'.tmp',stateFile);};
  const fail=(e:unknown)=>{state.phase='error';state.error=e instanceof Error?e.message:String(e);save();};
  const status=()=>{if(state.phase==='installing'&&existsSync(stateFile)){try{const disk=JSON.parse(readFileSync(stateFile,'utf8'));if(['completed','error'].includes(disk.phase))state={...state,...disk,currentVersion,supported};}catch{}}return{...state};};
  const assertSupported=()=>{if(!supported)throw badRequest('업데이트 설치는 Windows PC 설치판에서 사용할 수 있습니다.');};
  const assertIdle=()=>{if(busy||state.phase==='installing')throw badRequest('다른 업데이트 작업이 진행 중입니다.');};
  const get=runtime.fetch??fetch;
  async function check(){assertIdle();busy=true;state.phase='checking';state.error=null;save();try{const response=await get(UPDATE_MANIFEST_URL,{headers:{Accept:'application/vnd.github+json','User-Agent':'isumoa-updater'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(response.status===404?'아직 공개된 업데이트가 없거나 배포 페이지에 접속할 수 없습니다.':`업데이트 정보를 받지 못했습니다 (${response.status}).`);state.latest=parseUpdateRelease(await releaseMetadata(response));state.phase=compareVersions(state.latest.version,currentVersion)>0?'available':'current';state.checkedAt=new Date().toISOString();save();}catch(e){fail(e);}finally{busy=false;}return status();}
  async function receive(stream:AsyncIterable<Uint8Array>,expected:{version:string;sha256:string;bytes?:number}){
    const folder=join(directory,randomUUID());mkdirSync(folder,{recursive:true});const path=join(folder,'installer.exe'),fd=await open(path,'wx');const hash=createHash('sha256');let bytes=0;let signature=Buffer.alloc(0);
    let closed=false;
    try{for await(const chunk of stream){const data=Buffer.from(chunk);if(signature.length<2)signature=Buffer.concat([signature,data]).subarray(0,2);bytes+=data.length;if(bytes>300*1024*1024)throw Error('설치 파일이 300MB를 넘습니다.');hash.update(data);for(let offset=0;offset<data.length;){const result=await fd.write(data,offset,data.length-offset);if(!result.bytesWritten)throw Error('설치 파일 저장 실패');offset+=result.bytesWritten;}state.downloadedBytes=bytes;}if(signature.toString('ascii')!=='MZ'||(expected.bytes!==undefined&&bytes!==expected.bytes)||hash.digest('hex')!==expected.sha256)throw Error('설치 파일의 크기 또는 SHA-256이 다릅니다. 다시 받아 주세요.');ready={path,version:expected.version,sha256:expected.sha256};state.preparedVersion=expected.version;state.error=null;}catch(e){await fd.close();closed=true;rmSync(folder,{recursive:true,force:true});throw e;}finally{if(!closed)await fd.close();}
  }
  function download(){assertSupported();assertIdle();if(!state.latest||compareVersions(state.latest.version,currentVersion)<=0)throw badRequest('먼저 새 버전이 있는지 확인해 주세요.');const latest=state.latest;busy=true;state.phase='downloading';state.downloadedBytes=0;state.error=null;save();void(async()=>{try{const response=await get(latest.downloadUrl,{redirect:'follow',signal:AbortSignal.timeout(600000)});const u=new URL(response.url||latest.downloadUrl);if(u.protocol!=='https:'||!['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(u.hostname))throw Error('허용되지 않은 다운로드 주소입니다.');if(!response.ok||!response.body)throw Error('설치 파일을 받지 못했습니다.');await receive(Readable.fromWeb(response.body as never),latest);busy=false;state.phase='ready';save();}catch(e){fail(e);}finally{busy=false;}})();return status();}
  async function upload(stream:AsyncIterable<Uint8Array>,filename:string,sha256:string){assertSupported();assertIdle();const m=/^(?:isumoa-setup-|이수모아-설치-)(\d+\.\d+\.\d+)-win-x64\.exe$/.exec(filename.normalize('NFC'));if(!m||!/^[a-fA-F0-9]{64}$/.test(sha256)||compareVersions(m[1],currentVersion)<0)throw badRequest('공식 설치 EXE 이름과 SHA-256을 확인해 주세요. 이전 버전은 설치할 수 없습니다.');busy=true;state.phase='downloading';state.error=null;state.downloadedBytes=0;save();try{await receive(stream,{version:m[1],sha256:sha256.toLowerCase()});busy=false;state.phase='ready';save();}catch(e){fail(e);}finally{busy=false;}return status();}
  async function install(before:()=>Promise<void>){assertSupported();assertIdle();if(!ready||state.phase!=='ready')throw badRequest('검사가 끝난 설치 파일이 없습니다.');if(await fileHash(ready.path)!==ready.sha256)throw badRequest('준비된 설치 파일이 변경됐습니다. 다시 받으세요.');const free=runtime.freeBytes?await runtime.freeBytes():await statfs(directory).then(s=>Number(s.bavail)*Number(s.bsize));if(free<2*1024**3)throw badRequest('업데이트를 위해 디스크 여유 공간이 2GB 이상 필요합니다.');busy=true;try{writeFileSync(join(directory,'install.lock'),new Date().toISOString());await before();const receipt=join(dirname(ready.path),'request.json');writeFileSync(receipt,JSON.stringify({application:'isumoa-update-v1',installer:ready.path,sha256:ready.sha256,version:ready.version,config:config.configPath,dataDir:config.dataDir,statusFile:stateFile,lockFile:join(directory,'install.lock')},null,2));writeFileSync(join(directory,'install.lock'),new Date().toISOString());state.phase='installing';state.error=null;save();if(runtime.launch)await runtime.launch(receipt);else{const local=join(dirname(ready.path),'helper');mkdirSync(local,{recursive:true});for(const name of ['apply-update.ps1','common.ps1','maintenance.ps1'])copyFileSync(join(APP_ROOT,'..',name),join(local,name));await new Promise<void>((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(local,'apply-update.ps1'),'-Request',receipt],{detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});} }catch(e){rmSync(join(directory,'install.lock'),{force:true});fail(e);}finally{busy=false;}return status();}
  return{status,check,download,upload,install};
}
