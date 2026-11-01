/** 소수점 스크롤·브라우저 반올림을 고려해 오른쪽에 남은 내용이 있는지 계산한다. */
export function hasMoreColumns(scrollLeft:number,clientWidth:number,scrollWidth:number):boolean {return clientWidth>0&&scrollWidth-clientWidth-Math.max(0,scrollLeft)>1;}
