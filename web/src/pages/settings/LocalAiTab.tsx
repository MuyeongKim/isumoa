import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { LocalAiSettings, LocalModel } from '@shared/reviewTools.ts';
import type { EditGuard } from '@/lib/unsavedChanges';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, FormError, Input, Select } from '@/components/ui/Field';
function LocalAiForm({initial}:{initial:LocalAiSettings}){
 const guard=useOutletContext<EditGuard>(),qc=useQueryClient(),[form,setForm]=useState(initial),[baseline,setBaseline]=useState(JSON.stringify(initial)),[models,setModels]=useState<LocalModel[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[message,setMessage]=useState('');const key=JSON.stringify(form),dirty=key!==baseline;
 async function save(){setBusy(true);setError(null);try{const saved=await api.put<LocalAiSettings>('/local-ai',form);setForm(saved);setBaseline(JSON.stringify(saved));toast.success(saved.enabled?'로컬 AI 추가 검토를 켰습니다. 검수함에서 요청할 때만 실행합니다.':'규칙 기반 검수 모드로 저장했습니다.');await qc.invalidateQueries({queryKey:['local-ai']});await qc.invalidateQueries({queryKey:['review-tools']});return true}catch(e){setError(errorMessage(e));return false}finally{setBusy(false)}}
 useEffect(()=>{guard.setPendingEdits(dirty||busy?{dirty,busy,save,discard:()=>setForm(JSON.parse(baseline)),saveDescription:'로컬 AI 설정을 저장한 뒤 이동합니다. 수료증을 자동 전송하거나 확정하지 않습니다.'}:null)},[guard,key,baseline,busy]);useEffect(()=>()=>guard.clearPendingEdits(),[guard]);
 async function probe(){setBusy(true);setError(null);setMessage('');try{const r=await api.post<{models:LocalModel[];excluded:number}>('/local-ai/probe',{...form,model:''});setModels(r.models);if(form.model&&!r.models.some(m=>m.name===form.model))setForm({...form,model:''});setMessage(`로컬 서버 연결을 확인했습니다. 선택 가능한 모델 ${r.models.length}개 · 제외 ${r.excluded}개. 모델 선택 후 저장하면 로컬 생성 모델인지 한 번 더 확인합니다.`);}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}
 const choices=models.length?models:form.model?[{name:form.model,size:0,digest:''}]:[];
 return <form className="max-w-3xl space-y-5" onSubmit={e=>{e.preventDefault();void save()}}><h2 className="text-[18px] font-bold">로컬 AI 추가 검토 (선택)</h2><p className="text-[14px] text-ink-soft">LLM이 없는 PC에서도 OCR·규칙 검수를 그대로 사용할 수 있습니다. 기본은 꺼짐입니다. 모델은 설치본에 포함하거나 자동 다운로드하지 않습니다.</p><FormError message={error}/>
  <label className="flex items-center gap-3 rounded-xl border border-line bg-sheet p-4 text-[15px] font-semibold"><input type="checkbox" className="size-5 accent-navy" checked={form.enabled} disabled={busy} onChange={e=>setForm({...form,enabled:e.target.checked})}/>로컬 AI 추가 검토 사용</label>
  <Field label="Ollama 로컬 서버 주소" htmlFor="local-ai-url" hint="같은 PC의 로컬 주소만 허용합니다. 내부망·외부 서버와 클라우드 모델은 연결하지 않습니다."><Input id="local-ai-url" value={form.endpoint} disabled={busy} placeholder="http://127.0.0.1:11434" onChange={e=>setForm({...form,endpoint:e.target.value})}/></Field>
  <Button onClick={()=>void probe()} loading={busy}>연결 테스트·모델 목록</Button>{message&&<p role="status" className="text-[13px] text-ok">{message}</p>}
  <Field label="사용할 로컬 모델" htmlFor="local-ai-model" hint="Ollama에 이미 내려받은 생성 모델을 선택합니다. 임베딩·원격·클라우드 모델은 사용하지 않습니다."><Select id="local-ai-model" value={form.model} disabled={busy} onChange={e=>setForm({...form,model:e.target.value})}><option value="">모델 선택</option>{choices.map(m=><option key={m.name} value={m.name}>{m.name}{m.size?' · '+(m.size/1024**3).toFixed(1)+'GB':''}</option>)}</Select></Field>
  <Field label="최대 응답 대기 (초)" htmlFor="local-ai-timeout" hint="시간이 지나거나 서버가 꺼져 있어도 규칙 검수는 계속 사용할 수 있습니다."><Input id="local-ai-timeout" type="number" min={5} max={120} value={form.timeoutSeconds} disabled={busy} onChange={e=>setForm({...form,timeoutSeconds:Number(e.target.value)})}/></Field>
  <div className="rounded-xl bg-paper p-4 text-[13px] leading-relaxed"><p>켜 둔 상태에서 검수함의 ‘AI 추가 검토’를 누르면 선택한 수료증의 판독값과 개인정보를 가림 처리한 원문 일부가 이 PC의 모델로 전달됩니다. 가림 처리가 모든 식별정보 제거를 보장하지는 않으므로 같은 PC의 신뢰하는 모델만 연결하세요.</p><p className="mt-2">AI 제안은 참고 의견입니다. 자동 적용·확정하지 않으며 주제 충돌과 중복 확정 차단을 해제하지 않습니다. OCR 글자가 틀리면 AI도 틀린 의견을 낼 수 있습니다. Ollama의 클라우드 기능은 별도로 꺼 두는 것을 권장합니다.</p></div>
  <div className="flex items-center gap-3"><Button type="submit" variant="primary" loading={busy}>로컬 AI 설정 저장</Button><span role="status" className="text-[13px] text-ink-soft">{dirty?'저장 전 변경사항 있음':form.enabled?'추가 검토 사용 설정':'규칙 검수만 사용'}</span></div>
 </form>;
}
export function LocalAiTab(){const q=useQuery({queryKey:['local-ai'],queryFn:()=>api.get<LocalAiSettings>('/local-ai')});if(q.isPending)return <p>설정을 불러오고 있습니다.</p>;if(q.isError)return <><FormError message={errorMessage(q.error)}/><Button onClick={()=>void q.refetch()}>다시 불러오기</Button></>;return <LocalAiForm initial={q.data}/>;}
