import type { RulePreview } from '@shared/reviewTools.ts';
import { Button } from '@/components/ui/Button';
import { Dialog, DialogActions } from '@/components/ui/Dialog';
import { FormError } from '@/components/ui/Field';
export function RulePreviewDialog({preview,error,busy,onClose,onApply,closeLabel='닫기'}:{preview:RulePreview|null;error:string|null;busy:boolean;onClose:()=>void;onApply:()=>void;closeLabel?:string}){
 return <Dialog open={!!preview} onClose={onClose} title="규칙 변경 미리보기" busy={busy} width="lg" description="적용해도 직원·기관별 교육 기준·기존 수료증 값은 변경하지 않습니다.">
  {preview&&<div className="space-y-4"><FormError message={error}/><p className="font-semibold">{preview.kind==='official'?'공식 규칙':'사용자 규칙'} · {preview.pack.name} · {preview.version}</p>
   <div className="grid gap-3 sm:grid-cols-3">{(['added','changed','removed'] as const).map((k,i)=><div key={k} className="rounded-lg bg-paper p-3"><p className="font-semibold">{['추가','변경','삭제'][i]} {preview.changes[k].length}개</p><ul className="mt-2 max-h-48 overflow-auto text-[13px]">{preview.changes[k].map((v,i)=><li key={i}>{v}</li>)}</ul></div>)}</div>
   {preview.changes.aliasesChanged&&<p>인식 항목 이름도 변경됩니다.</p>}<p className="text-[13px] text-ink-soft">현재 설정은 이력에 보관합니다. 수료증을 읽는 중에는 적용할 수 없습니다. {preview.kind==='official'?'사용자 규칙은 별도로 보존합니다.':''}</p>
   <DialogActions><Button disabled={busy} onClick={onClose}>{closeLabel}</Button><Button variant="primary" loading={busy} onClick={onApply}>이 규칙 적용</Button></DialogActions>
  </div>}
 </Dialog>;
}
