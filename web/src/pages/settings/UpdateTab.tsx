import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { UpdateStatus } from '@shared/updateChannel.ts';
import { Button, buttonClass } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { api, errorMessage } from '@/lib/api';

export function UpdateTab(){
 const qc=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[confirm,setConfirm]=useState(false),[sha,setSha]=useState(''),[file,setFile]=useState<File|null>(null);
 const query=useQuery({queryKey:['system','update'],queryFn:()=>api.get<UpdateStatus>('/system/update'),refetchInterval:q=>['downloading','installing'].includes(q.state.data?.phase??'')?1000:false,retry:1});
 const data=query.data,inProgress=busy||['checking','downloading','installing'].includes(data?.phase??'');
 async function run(path:string,body:unknown={}){setBusy(true);setError(null);try{const next=await api.post<UpdateStatus>(path,body);qc.setQueryData(['system','update'],next);}catch(e){setError(errorMessage(e));}finally{setBusy(false)}}
 async function localFile(){if(!file)return;const body=new FormData();body.append('sha256',sha.trim());body.append('file',file);await run('/system/update/file',body);}
 if(query.isPending)return <p role="status">업데이트 상태를 확인하고 있습니다.</p>;
 if(!data)return <><FormError message={errorMessage(query.error)}/><Button onClick={()=>void query.refetch()}>다시 불러오기</Button></>;
 const progress=data.latest?.bytes?Math.min(100,Math.floor(data.downloadedBytes/data.latest.bytes*100)):null;
 return <section className="max-w-4xl space-y-4 rounded-2xl border border-line bg-sheet p-6 shadow-surface">
   <h2 className="text-[18px] font-bold">프로그램 업데이트</h2>
   <p className="text-[13.5px] text-ink-soft">확인·다운로드 버튼을 누를 때만 GitHub 공개 배포 페이지에 접속합니다. 직원 명단과 수료증은 보내지 않습니다. 업데이트 중에는 자료 변경이 잠시 중지됩니다.</p>
   <dl className="grid grid-cols-[120px_1fr] gap-2 text-[14px]"><dt>현재 버전</dt><dd>v{data.currentVersion}</dd><dt>최신 버전</dt><dd>{data.latest?`v${data.latest.version}`:'아직 확인하지 않았습니다.'}</dd>{data.preparedVersion&&<><dt>설치할 버전</dt><dd>v{data.preparedVersion}</dd></>}</dl>
   {!data.supported&&<p className="rounded-lg bg-paper p-3 text-[13.5px]">버전 확인은 사용할 수 있습니다. 자동 설치와 설치 파일 검사는 Windows PC 설치판에서 지원합니다.</p>}
   <FormError message={error??data.error}/>
   {query.isError&&data.phase==='installing'&&<p role="status">프로그램을 재시작하고 있습니다. 이 화면을 잠시 유지해 주세요.</p>}
   {data.phase==='downloading'&&<div role="status"><p>설치 파일을 받는 중입니다. {progress===null?`${(data.downloadedBytes/1024/1024).toFixed(1)}MB`:`${progress}%`}</p><progress className="w-full" value={progress??undefined} max={100}/></div>}
   {data.phase==='installing'&&<p role="status" className="text-navy">백업·설치·새 버전 실행을 진행하고 있습니다. 진행 중에는 PC를 끄지 마세요.</p>}
   {data.phase==='completed'&&<p role="status" className="text-ok">업데이트 절차를 마쳤습니다. 새로고침한 뒤 현재 버전을 확인하세요.</p>}
   {data.phase==='current'&&<p role="status" className="text-ok">현재 설치 버전이 최신 공개 버전 이상입니다.</p>}
   <div className="flex flex-wrap gap-2"><Button loading={busy} disabled={inProgress} onClick={()=>void run('/system/update/check')}>최신 버전 확인</Button>{['available','error'].includes(data.phase)&&data.latest&&<Button disabled={!data.supported||inProgress} onClick={()=>void run('/system/update/download')}>업데이트 받기</Button>}{data.phase==='ready'&&<Button variant="primary" disabled={inProgress} onClick={()=>setConfirm(true)}>업데이트 설치</Button>}{data.phase==='completed'&&<Button onClick={()=>window.location.reload()}>새로고침</Button>}<a className={buttonClass()} href={data.releasesUrl} target="_blank" rel="noopener noreferrer">배포 페이지 열기</a></div>
   {data.latest?.notes&&<details><summary className="cursor-pointer text-[14px] font-semibold">변경 내용</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-paper p-3 font-sans text-[13px] whitespace-pre-wrap">{data.latest.notes}</pre></details>}
   <details><summary className="cursor-pointer text-[14px] font-semibold">설치 파일로 업데이트 (인터넷 연결이 어려운 경우)</summary><div className="mt-3 space-y-3"><p className="text-[13px] text-ink-soft">공식 배포 EXE와 함께 받은 SHA256SUMS의 해당 파일 해시를 입력하세요. 검사가 끝난 파일만 설치할 수 있습니다.</p><Field label="Windows 설치 EXE" htmlFor="update-file"><Input id="update-file" type="file" accept=".exe" disabled={!data.supported||inProgress} onChange={e=>setFile(e.target.files?.[0]??null)}/></Field><Field label="SHA-256" htmlFor="update-sha"><Input id="update-sha" value={sha} maxLength={64} disabled={!data.supported||inProgress} onChange={e=>setSha(e.target.value)} placeholder="배포 페이지에서 확인한 64자리 해시"/></Field><Button disabled={!data.supported||inProgress||!file||!/^[a-fA-F0-9]{64}$/.test(sha.trim())} onClick={()=>void localFile()}>설치 파일 검사</Button></div></details>
   <ConfirmDialog open={confirm} title="업데이트를 설치할까요?" description={`v${data.preparedVersion??''} 설치 전 자료를 백업합니다. 수료증 읽기가 끝나야 진행할 수 있으며, 설치 후 프로그램이 다시 실행됩니다. 설치·기동 실패 시 이전 버전과 자료 복구를 시도합니다.`} confirmLabel="백업 후 설치" onClose={()=>setConfirm(false)} onConfirm={()=>{setConfirm(false);void run('/system/update/install');}}/>
 </section>;
}
