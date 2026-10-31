import { useUpdateCenter } from '@/lib/updateCenter';
export function UpdateNotice(){
 const {data,isError}=useUpdateCenter();
 if(!data)return null;
 if(isError)return <span className="ml-auto size-2 shrink-0 rounded-full bg-warn" role="img" aria-label="업데이트 상태 확인 실패"/>;
 if(data.availableCount>0)return <span className="ml-auto shrink-0 rounded-full bg-warn-soft px-2 text-[11.5px] leading-5 font-semibold text-warn" aria-label={`새 업데이트 ${data.availableCount}건`}>새 버전 {data.availableCount}</span>;
 if(data.hasCheckError)return <span className="ml-auto size-2 shrink-0 rounded-full bg-warn" role="img" aria-label="업데이트 확인 실패" title="업데이트 정보를 확인하지 못했습니다."/>;
 return null;
}
