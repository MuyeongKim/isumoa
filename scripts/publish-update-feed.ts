// 정식 릴리스 게시 후 관리자 개발 PC에서 실행. 배포 전용 공개 저장소만 갱신한다.
import { execFileSync } from 'node:child_process';
import { parseUpdateRelease, UPDATE_REPOSITORY } from '../shared/updateChannel.ts';
const version=process.argv[2];
if(!version||!/^\d+\.\d+\.\d+$/.test(version))throw Error('버전을 지정하세요: npm run release:feed -- 0.5.0');
const api=(path:string)=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8'}));
const release=api(`repos/${UPDATE_REPOSITORY}/releases/tags/v${version}`);
const checked=parseUpdateRelease(release);
if(checked.version!==version)throw Error('릴리스 버전이 다릅니다.');
let sha:string|undefined;
try { sha=api(`repos/${UPDATE_REPOSITORY}/contents/latest.json`).sha; }
catch(e){if(!String((e as {stderr?:unknown}).stderr).includes('404'))throw e;}
const content=Buffer.from(JSON.stringify(release,null,2)+'\n').toString('base64');
execFileSync('gh',['api','--method','PUT',`repos/${UPDATE_REPOSITORY}/contents/latest.json`,'--input','-'],{input:JSON.stringify({message:`Publish update feed v${version}`,content,...(sha?{sha}:{})}),stdio:['pipe','ignore','inherit']});
console.log(`업데이트 피드 게시: ${UPDATE_REPOSITORY} v${version}`);
