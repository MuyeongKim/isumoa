import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { hasMoreColumns } from '@shared/horizontalScroll.ts';

/** 표의 열이 화면 밖에 있음을 알리고, 끝까지 이동하면 표시를 거둔다. */
export function ScrollableTable({children,label,className,onMouseLeave}:{children:ReactNode;label:string;className:string;onMouseLeave?:()=>void}){
 const ref=useRef<HTMLDivElement>(null),hint=useId(); const [more,setMore]=useState(false);
 useEffect(()=>{const el=ref.current;if(!el)return;const update=()=>setMore(hasMoreColumns(el.scrollLeft,el.clientWidth,el.scrollWidth));update();el.addEventListener('scroll',update,{passive:true});const observer=new ResizeObserver(update);observer.observe(el);if(el.firstElementChild)observer.observe(el.firstElementChild);return()=>{el.removeEventListener('scroll',update);observer.disconnect();};},[]);
 return <div className="relative min-w-0">{more&&<p id={hint} className="mb-2 text-right text-[13px] font-medium text-ink-soft">오른쪽에 교육 항목이 더 있습니다 → <span className="font-normal">(가로로 스크롤)</span></p>}<div ref={ref} tabIndex={0} role="region" aria-label={label} aria-describedby={more?hint:undefined} className={className} onMouseLeave={onMouseLeave}>{children}</div>{more&&<div aria-hidden="true" className="pointer-events-none absolute top-8 right-0 bottom-0 w-6 rounded-r-2xl shadow-[-12px_0_16px_-12px_rgb(22_27_38/0.4)_inset]" />}</div>;
}
