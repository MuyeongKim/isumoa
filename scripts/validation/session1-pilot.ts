// 두 방법의 작업량을 맞춘 가상 직원 실측 자료. 실제 명단·수료증을 사용하지 않는다.
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ZipArchive } from 'archiver';
import { DEPLOYMENT_TRAININGS } from '../../shared/deploymentCatalog.ts';
import { drawCertificate, drawMemo, type CertData } from '../fixtures/certificate.ts';
import { renderTextPdf } from '../fixtures/render.ts';
const out=process.argv[2] ? resolve(process.argv[2]) : null;
if(!out)throw Error('새 출력 폴더를 지정하세요.');if(existsSync(join(out,'정답_진행자용.json')))throw Error('기존 자료를 덮어쓰지 않습니다.');mkdirSync(out,{recursive:true});
const people=[{set:'A',name:'홍길동',birth:'1981-03-02',dept:'가상총무과',empNo:'SYN-A'},{set:'B',name:'김하나',birth:'1990-07-15',dept:'가상기획과',empNo:'SYN-B'}];
writeFileSync(join(out,'모의직원명단.csv'),'\uFEFF사번,성명,부서,생년월일,재직상태\r\n'+people.map(p=>`${p.empNo},${p.name},${p.dept},${p.birth},재직`).join('\r\n')+'\r\n');
const truth=[];
for(const [personIndex,p] of people.entries()){
 const pages=[],answers=[];for(const [i,t] of DEPLOYMENT_TRAININGS.entries()){
  const d:CertData={template:'formal',name:p.name,birth:p.birth,department:p.dept,courseTitle:t.name,periodStart:`2026-0${personIndex+5}-01`,completedOn:`2026-0${personIndex+5}-${String(i+1).padStart(2,'0')}`,hoursText:`${t.reqValue}시간`,certNo:`PILOT-${p.set}-${i+1}`};
  pages.push(drawCertificate(d));answers.push({page:i+1,decision:'인정',name:p.name,code:t.code,title:t.name,date:d.completedOn,hours:t.reqValue,certNo:d.certNo});
 }
 pages.push(pages[0]);answers.push({page:17,decision:'제외',reason:'1쪽과 동일한 수료증 중복'});
 pages.push(drawCertificate({template:'formal',name:p.name,birth:p.birth,department:p.dept,courseTitle:'정보보안 실무',periodStart:'2026-07-01',completedOn:'2026-07-02',hoursText:'1시간',certNo:`PILOT-${p.set}-OUT`}));answers.push({page:18,decision:'제외',reason:'기본 관리 대상 밖. 정보공개 교육으로 인정하지 않음'});
 pages.push(drawMemo(['교육 안내문','과정명 : 개인정보보호 교육','신청기간 : 2026-07-01 ~ 2026-07-15','성명 : '+p.name]));answers.push({page:19,decision:'제외',reason:'수료증이 아닌 신청 안내'});
 const all=await renderTextPdf(pages),certs=await renderTextPdf(pages.slice(0,17)),extra=await renderTextPdf(pages.slice(17));
 writeFileSync(join(out,`모의자료${p.set}.pdf`),all);
 const archive=new ZipArchive({zlib:{level:9}}),stream=createWriteStream(join(out,`모의자료${p.set}.zip`));archive.pipe(stream);const closed=new Promise<void>((resolve,reject)=>{stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);});archive.append(Buffer.from(certs),{name:`수료증${p.set}.pdf`});archive.append(Buffer.from(extra),{name:`확인할자료${p.set}.pdf`});await archive.finalize();await closed;
 truth.push({set:p.set,syntheticOnly:true,expected:{confirmed:16,excluded:3,completedEmployees:1},answers});
}
writeFileSync(join(out,'정답_진행자용.json'),JSON.stringify(truth,null,2));
console.log('가상 A/B 자료 각 19쪽, PDF·ZIP·CSV·별도 정답표 생성');
