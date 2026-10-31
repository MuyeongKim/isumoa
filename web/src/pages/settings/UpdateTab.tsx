import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UpdateCenterStatus, UpdateCheckState, UpdatePreferences, UpdateTarget } from '@shared/updateCenter.ts';
import type { OfficialRuleEnvelope, RulePreview } from '@shared/reviewTools.ts';
import type { UpdateStatus } from '@shared/updateChannel.ts';
import type { EditGuard } from '@/lib/unsavedChanges';
import { api, errorMessage } from '@/lib/api';
import { useUpdateCenter } from '@/lib/updateCenter';
import { Button, buttonClass } from '@/components/ui/Button';
import { Field, FormError, Input } from '@/components/ui/Field';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RulePreviewDialog } from './RulePreviewDialog';
const stamp=(value:string|null)=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 확인하지 않았습니다.';
const names:Record<UpdateCheckState,string>={unchecked:'확인 전',checking:'확인 중',current:'새 업데이트 없음',available:'새 버전 있음',requires_program:'프로그램 업데이트 필요',error:'확인하지 못함'};
function CheckLabel({state}:{state:UpdateCheckState}){return <span role="status" className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${state==='error'||state==='requires_program'?'bg-warn-soft text-warn':state==='available'?'bg-navy-soft text-navy':'bg-paper text-ink-soft'}`}>{names[state]}</span>}
function CheckTimes({attemptedAt,succeededAt}:{attemptedAt:string|null;succeededAt:string|null}){return <div className="mt-3 text-[12px] leading-relaxed text-ink-faint"><p>마지막 확인 시도: {stamp(attemptedAt)}</p><p>마지막 확인 성공: {stamp(succeededAt)}</p></div>}
function AutomaticForm({data}:{data:UpdateCenterStatus}){
 const guard=useOutletContext<EditGuard>(),qc=useQueryClient(),[draft,setDraft]=useState(data.preferences.autoEnabled),[baseline,setBaseline]=useState(data.preferences.autoEnabled),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null),dirty=draft!==baseline;
 useEffect(()=>{if(!dirty&&!saving){setDraft(data.preferences.autoEnabled);setBaseline(data.preferences.autoEnabled)}},[data.preferences.autoEnabled,dirty,saving]);
 async function save(){setSaving(true);setError(null);try{const next=await api.put<UpdateCenterStatus>('/system/updates/preferences',{autoEnabled:draft} satisfies UpdatePreferences);qc.setQueryData(['update-center'],next);setDraft(next.preferences.autoEnabled);setBaseline(next.preferences.autoEnabled);await qc.invalidateQueries({queryKey:['update-center']});toast.success(next.preferences.autoEnabled?'하루 한 번 자동 버전 확인을 켰습니다. 설치와 규칙 적용은 직접 선택합니다.':'자동 버전 확인을 껐습니다. 모두 확인 버튼은 계속 사용할 수 있습니다.');return true}catch(e){setError(errorMessage(e));return false}finally{setSaving(false)}}
 useEffect(()=>{guard.setPendingEdits(dirty||saving?{dirty,busy:saving,save,discard:()=>setDraft(baseline),saveDescription:'자동 버전 확인 설정을 저장한 뒤 이동합니다. 설치와 규칙 적용은 자동으로 진행하지 않습니다.'}:null)},[guard,dirty,saving,draft,baseline]);useEffect(()=>()=>guard.clearPendingEdits(),[guard]);
 return <form className="rounded-xl border border-line bg-sheet p-5" onSubmit={e=>{e.preventDefault();void save()}}><h3 className="text-[16px] font-bold">자동 확인·알림 (선택)</h3><FormError message={error}/><label className="mt-3 flex items-start gap-3 text-[14px]"><input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-navy" checked={draft} disabled={saving} onChange={e=>setDraft(e.target.checked)}/><span><strong>실행할 때 하루 한 번 새 버전 확인</strong><span className="mt-1 block text-[13px] font-normal leading-relaxed text-ink-soft">기본은 꺼짐입니다. 켜서 저장하면 오늘 확인을 먼저 시도합니다. 이후 한국 날짜 기준 하루 한 번 프로그램·공식 규칙을 확인합니다. 계속 켜 둔 PC는 다음 날에도 확인하고, 새 버전이 있으면 설정 메뉴에 표시합니다. 설치·규칙 적용은 자동으로 하지 않습니다.</span></span></label><p className="mt-3 text-[12.5px] text-ink-faint">최근 자동 확인 시도: {data.lastAutomaticDay??'아직 없음'} · 탭이나 창을 여러 개 열어도 이 PC에서 한 번만 조회합니다.</p><div className="mt-4 flex flex-wrap items-center gap-3"><Button type="submit" loading={saving}>자동 확인 설정 저장</Button><span className="text-[12.5px] text-ink-soft">{dirty?'저장 전 변경사항 있음':baseline?'자동 확인 켜짐':'자동 확인 꺼짐'}</span></div></form>;
}
export function UpdateTab(){
 const qc=useQueryClient(),query=useUpdateCenter(),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[confirm,setConfirm]=useState(false),[sha,setSha]=useState(''),[file,setFile]=useState<File|null>(null),[rulesPreview,setRulesPreview]=useState<{preview:RulePreview;envelope:OfficialRuleEnvelope}|null>(null);
 const data=query.data,installer=data?.program.installer,inProgress=busy||data?.checking||['checking','downloading','installing'].includes(installer?.phase??'');
 async function refresh(){await qc.invalidateQueries({queryKey:['update-center']});}
 async function check(target:UpdateTarget){setBusy(true);setError(null);try{const next=await api.post<UpdateCenterStatus>('/system/updates/check',{target});qc.setQueryData(['update-center'],next)}catch(e){setError(errorMessage(e))}finally{setBusy(false);void refresh()}}
 async function program(path:string,body:unknown={}){setBusy(true);setError(null);try{await api.post<UpdateStatus|UpdateCenterStatus>(path,body);await refresh()}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 async function preview(){setBusy(true);setError(null);try{setRulesPreview(await api.post('/system/updates/rules/preview'))}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 async function applyRules(){if(!rulesPreview)return;setBusy(true);setError(null);try{await api.post('/rules/apply',rulesPreview);setRulesPreview(null);await Promise.all([refresh(),qc.invalidateQueries({queryKey:['rules']}),qc.invalidateQueries({queryKey:['review-tools']})]);toast.success('공식 규칙을 적용했습니다. 사용자 규칙과 기존 수료증은 보존합니다.')}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 async function localFile(){if(!file)return;const body=new FormData();body.append('sha256',sha.trim());body.append('file',file);await program('/system/update/file',body)}
 if(query.isPending)return <p role="status">업데이트 정보를 불러오고 있습니다.</p>;
 if(!data||!installer)return <><FormError message={errorMessage(query.error)}/><Button onClick={()=>void query.refetch()}>다시 불러오기</Button></>;
 const disconnected=query.isError&&installer.phase!=='installing';
 const p={...data.program,state:disconnected?'error' as const:data.program.state},r={...data.rules,state:disconnected?'error' as const:data.rules.state},progress=installer.latest?.bytes?Math.min(100,Math.floor(installer.downloadedBytes/installer.latest.bytes*100)):null;
 return <div className="max-w-4xl space-y-5">
  <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-[19px] font-bold">프로그램·공식 규칙 업데이트</h2><p className="mt-1 text-[13.5px] text-ink-soft">GitHub 공개 배포 정보만 조회합니다. 직원 명단·수료증은 보내지 않습니다.</p></div><Button variant="primary" loading={busy} disabled={inProgress} onClick={()=>void check('all')}>모두 확인</Button></div>
  <FormError message={error}/>{query.isError&&<FormError message={installer.phase==='installing'?'프로그램을 재시작하고 있습니다. 이 화면을 유지하고 잠시 후 다시 불러오세요.':'상태를 불러오지 못했습니다. 마지막 표시 정보만 남아 있으니 연결을 확인하고 다시 불러오세요.'}/>}
  <div className="grid gap-5 xl:grid-cols-2">
  <section className="rounded-xl border border-line bg-sheet p-5" aria-label="프로그램 업데이트"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-bold">프로그램 (EXE)</h3><CheckLabel state={p.state}/></div>
   <dl className="mt-4 grid grid-cols-[110px_1fr] gap-2 text-[14px]"><dt className="text-ink-faint">현재 버전</dt><dd className="font-semibold">v{p.currentVersion}</dd><dt className="text-ink-faint">{p.state==='error'?'이전 확인 버전':'최신 확인 버전'}</dt><dd>{p.latest?'v'+p.latest.version:'아직 확인하지 않았습니다.'}</dd>{installer.preparedVersion&&['ready','installing','completed'].includes(installer.phase)&&<><dt>{installer.phase==='completed'?'설치 완료 버전':'설치할 버전'}</dt><dd>v{installer.preparedVersion}</dd></>}</dl>
   <CheckTimes attemptedAt={p.attemptedAt} succeededAt={p.succeededAt}/><FormError message={p.error??installer.error}/>
   {!installer.supported&&<p className="mt-3 rounded-lg bg-paper p-3 text-[13px]">버전 확인은 사용할 수 있습니다. EXE 검사·다운로드·설치는 Windows PC 설치판에서 지원합니다.</p>}
   {installer.phase==='downloading'&&<div role="status" className="mt-3"><p className="text-[13px]">설치 파일 받는 중 · {progress===null?`${(installer.downloadedBytes/1024/1024).toFixed(1)}MB`:`${progress}%`}</p><progress className="w-full" value={progress??undefined} max={100}/></div>}
   {installer.phase==='installing'&&<p role="status" className="mt-3 text-[14px] text-navy">백업·설치·새 버전 실행을 진행하고 있습니다. 진행 중에는 PC를 끄지 마세요.</p>}
   {installer.phase==='completed'&&<p role="status" className="mt-3 text-[14px] text-ok">업데이트 절차를 마쳤습니다. 새로고침해 현재 버전을 확인하세요.</p>}
   <div className="mt-4 flex flex-wrap gap-2"><Button disabled={inProgress} onClick={()=>void check('program')}>프로그램만 확인</Button>{p.state==='available'&&installer.phase!=='ready'&&<Button disabled={!installer.supported||inProgress} onClick={()=>void program('/system/updates/program/download')}>업데이트 받기</Button>}{installer.phase==='ready'&&<Button variant="primary" disabled={inProgress} onClick={()=>setConfirm(true)}>업데이트 설치</Button>}{installer.phase==='completed'&&<Button onClick={()=>window.location.reload()}>새로고침</Button>}<a className={buttonClass('ghost')} href={installer.releasesUrl} target="_blank" rel="noopener noreferrer">배포 페이지 열기</a></div>
   {p.latest?.notes&&<details className="mt-4"><summary className="cursor-pointer text-[13.5px] font-semibold">프로그램 변경 내용</summary><pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-paper p-3 font-sans text-[13px] whitespace-pre-wrap">{p.latest.notes}</pre></details>}
  </section>
  <section className="rounded-xl border border-line bg-sheet p-5" aria-label="공식 규칙 업데이트"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[17px] font-bold">공식 검수 규칙</h3><CheckLabel state={r.state}/></div>
   <dl className="mt-4 grid grid-cols-[110px_1fr] gap-2 text-[14px]"><dt className="text-ink-faint">현재 버전</dt><dd className="font-semibold">{r.currentVersion}</dd><dt className="text-ink-faint">{r.state==='error'?'이전 확인 버전':'최신 확인 버전'}</dt><dd>{r.latest?r.latest.version:'아직 확인하지 않았습니다.'}</dd></dl><CheckTimes attemptedAt={r.attemptedAt} succeededAt={r.succeededAt}/><FormError message={r.error}/>
   {r.state==='requires_program'&&<p role="status" className="mt-3 rounded-lg bg-warn-soft p-3 text-[13px] text-warn">이 규칙은 프로그램 v{r.latest!.minimumAppVersion} 이상이 필요합니다. 프로그램을 먼저 업데이트한 뒤 규칙을 확인해 주세요.</p>}
   <p className="mt-3 text-[13px] text-ink-soft">사용자 규칙 {r.customCount}개 ({r.customVersion})는 별도로 보존합니다. 공식 규칙은 서명 검사와 변경 미리보기 후 직접 적용합니다.</p>
   <div className="mt-4 flex flex-wrap gap-2"><Button disabled={inProgress} onClick={()=>void check('rules')}>규칙만 확인</Button>{r.state==='available'&&<Button variant="primary" disabled={inProgress} onClick={()=>void preview()}>규칙 변경 미리보기</Button>}<Link className="inline-flex min-h-10 min-w-0 items-center rounded-lg px-3 py-2 text-[13.5px] font-semibold text-link underline-offset-4 hover:underline" to="/settings?tab=rules">사용자 규칙 편집·파일 가져오기·복원</Link></div>
  </section>
  </div>
  <AutomaticForm data={data}/>
  <details className="rounded-xl border border-line bg-sheet p-5"><summary className="cursor-pointer text-[14px] font-semibold">인터넷 연결이 어려운 PC에서 업데이트</summary><p className="mt-3 text-[13px] text-ink-soft">공식 EXE와 SHA256SUMS의 해당 파일 해시를 준비하세요. 규칙 JSON은 검수 규칙의 파일 가져오기를 사용할 수 있습니다. 연결에 실패한 경우 현재 버전이 최신이라고 판단하지 않습니다.</p><div className="mt-4 space-y-3"><Field label="Windows 설치 EXE" htmlFor="update-file"><Input id="update-file" type="file" accept=".exe" disabled={!installer.supported||inProgress} onChange={e=>setFile(e.target.files?.[0]??null)}/></Field><Field label="SHA-256" htmlFor="update-sha"><Input id="update-sha" value={sha} maxLength={64} disabled={!installer.supported||inProgress} onChange={e=>setSha(e.target.value)} placeholder="배포 페이지에서 확인한 64자리 해시"/></Field><Button disabled={!installer.supported||inProgress||!file||!/^[a-fA-F0-9]{64}$/.test(sha.trim())} onClick={()=>void localFile()}>설치 파일 검사</Button></div></details>
  <RulePreviewDialog preview={rulesPreview?.preview??null} error={error} busy={busy} onClose={()=>setRulesPreview(null)} onApply={()=>void applyRules()}/>
  <ConfirmDialog open={confirm} title="업데이트를 설치할까요?" description={`v${installer.preparedVersion??''} 설치 전 자료를 백업합니다. 수료증 읽기가 끝나야 진행할 수 있으며 설치 후 프로그램이 다시 실행됩니다. 설치·기동 실패 시 이전 버전과 자료 복구를 시도합니다.`} confirmLabel="백업 후 설치" onClose={()=>setConfirm(false)} onConfirm={()=>{setConfirm(false);void program('/system/update/install');}}/>
 </div>;
}
