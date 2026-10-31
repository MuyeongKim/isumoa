import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AssistResult, AssistSuggestion } from '@shared/reviewTools.ts';
import type { CertificateInput, Training } from '@shared/types.ts';
import { certificateInputKey } from '@shared/certificateInput.ts';
import { api, errorMessage } from '@/lib/api';
import { useCurrentUser } from '@/lib/session';
import { withBase } from '@/lib/base';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { FormError } from '@/components/ui/Field';
const labels={courseTitle:'과정명',provider:'교육기관',certNo:'증서번호',completedOn:'이수일',hours:'교육시간',trainingCodes:'인정할 교육'};
export function ReviewAssist({id,input,disabled,trainings,onApply,recognitionRuleVersion}:{id:number;input:CertificateInput;disabled:boolean;trainings:Training[];onApply:(suggestions:AssistSuggestion[])=>void;recognitionRuleVersion?:string|null}){
 const user=useCurrentUser();
 const [reviewKind,setReviewKind]=useState<'rules'|'local_llm'>('rules');
 const info=useQuery({queryKey:['review-tools'],queryFn:()=>api.get<{ruleVersion:string;aiEnabled:boolean;model:string|null}>('/review-tools/info')}),[busy,setBusy]=useState<'rules'|'local_llm'|null>(null),[result,setResult]=useState<AssistResult|null>(null),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<number[]>([]),[open,setOpen]=useState(false),[requestKey,setRequestKey]=useState('');const controller=useRef<AbortController|null>(null),key=certificateInputKey(input);
 useEffect(()=>{controller.current?.abort();setBusy(null);setResult(null);setOpen(false);setError(null);setSelected([])},[id,key]);useEffect(()=>()=>controller.current?.abort(),[]);
 function display(s:AssistSuggestion){if(s.field==='trainingCodes'&&Array.isArray(s.value))return s.value.map(code=>trainings.find(t=>t.code===code)?.name??code).join(', ');return String(s.value);}
 function current(s:AssistSuggestion){if(s.field==='trainingCodes')return input.credits.map(c=>trainings.find(t=>t.id===c.trainingId)?.name??'').join(', ');return String(input[s.field]??'비어 있음');}
 async function review(kind:'rules'|'local_llm'){setReviewKind(kind);controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(kind);setError(null);setResult(null);setSelected([]);setRequestKey(key);setOpen(true);try{const response=await fetch(withBase('/api/certificates/'+id+'/'+(kind==='rules'?'rules-review':'ai-review')),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-requested-with':'fetch'},body:JSON.stringify({input}),signal:c.signal});const data=await response.json();if(!response.ok)throw Error(data?.error?.message??'추가 검토를 완료하지 못했습니다.');if(!c.signal.aborted)setResult(data as AssistResult);}catch(e){if(!c.signal.aborted)setError(errorMessage(e));}finally{if(!c.signal.aborted)setBusy(null)}}
 return <details className="rounded-lg border border-line bg-paper/50 p-3 text-[12.5px]"><summary className="cursor-pointer font-semibold">추가 검토 (선택){info.data?.aiEnabled?' · 로컬 AI 사용 가능':''}</summary><p className="mt-2 break-words text-[11.5px] text-ink-faint">판독 당시 규칙: {recognitionRuleVersion??'이전 버전'}<br/>현재 규칙: {info.data?.ruleVersion??'불러오는 중'}</p><p className="mt-1 text-ink-faint">기존 입력은 유지하고 후보만 비교합니다. 자동 확정하지 않습니다.</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" disabled={disabled||!!busy} onClick={()=>void review('rules')}>규칙 다시 검토</Button><Button size="sm" disabled={disabled||!!busy||!info.data?.aiEnabled} onClick={()=>void review('local_llm')}>AI 추가 검토</Button></div>{!info.data?.aiEnabled&&<p className="mt-2 text-ink-faint">로컬 AI 꺼짐 · 규칙 검수는 정상 사용 중입니다. {user.role==='admin'&&<Link to="/settings?tab=local-ai" className="text-link underline">로컬 AI 설정</Link>}</p>}
  <Dialog open={open} onClose={()=>{controller.current?.abort();setBusy(null);setOpen(false)}} title={reviewKind==='local_llm'?'AI 추가 검토 의견':'규칙 다시 검토'} width="lg" description="현재 값과 원문 근거를 대조한 뒤 적용할 항목만 선택하세요. 추천이 정답이라는 보장은 없으며 확정은 별도입니다.">
   <FormError message={error}/>{busy&&<p role="status" className="py-4 text-[14px]">{busy==='local_llm'?'로컬 모델이 검토하고 있습니다. 닫아도 기존 입력값은 유지됩니다.':'현재 규칙으로 다시 비교하고 있습니다.'}</p>}
   {result&&<><p className="text-[13.5px]">{result.summary}</p><p className="mt-2 break-words text-[11.5px] text-ink-faint">규칙 {result.ruleVersion}{result.model?' · 모델 '+result.model:''}</p>{result.rejected>0&&<p className="mt-2 rounded-lg bg-warn-soft p-2 text-[13px] text-warn">길이·형식·원문 근거·주제 검사를 통과하지 못한 AI 제안 {result.rejected}개를 제외했습니다. {result.suggestions.length>0?'유효한 제안만 표시합니다.':'원본을 직접 대조하세요.'}</p>}
    <ul className="mt-4 max-h-[45dvh] space-y-3 overflow-auto">{result.suggestions.map((s,i)=><li key={s.field} className="rounded-lg border border-line p-3"><label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-navy" checked={selected.includes(i)} onChange={e=>setSelected(e.target.checked?[...selected,i]:selected.filter(n=>n!==i))}/><span className="min-w-0 flex-1"><strong>{labels[s.field]}</strong><span className="mt-1 grid gap-1 text-[13px]"><span>현재: {current(s)}</span><span className="font-semibold text-navy">추천: {display(s)}</span><span className="text-ink-soft">이유: {s.reason}</span><span className="break-words rounded bg-paper p-2">원문 근거: {s.evidence}</span></span></span></label></li>)}</ul>
    {!result.suggestions.length&&<p className="mt-4 text-[13px] text-ink-soft">적용할 새 제안이 없습니다. 원본을 직접 대조하세요.</p>}
   </>}
   <DialogActions><Button onClick={()=>{controller.current?.abort();setBusy(null);setOpen(false)}}>기존 입력 유지하고 닫기</Button><Button variant="primary" disabled={!!busy||disabled||!result||!selected.length||requestKey!==key} onClick={()=>{if(result&&requestKey===key){const chosen=selected.map(i=>result.suggestions[i]);setOpen(false);onApply(chosen)}}}>선택한 제안 편집값에 반영</Button></DialogActions>
  </Dialog>
 </details>;
}
