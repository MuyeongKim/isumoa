import type { ReactNode } from 'react';
import { LogoMark } from '@/components/LogoMark';

// 왼쪽 판의 칸 무늬: 대시보드 직원 지도처럼 칸이 하나씩 채워지는 모습 (꽉 참 / 반 / 빈 칸)
const CELLS = Array.from({ length: 48 }, (_, i) => {
  const v = (i * 37 + 11) % 10;
  return v < 5 ? 'full' : v < 7 ? 'half' : 'empty';
});

/** 로그인·초기 설정 화면: 왼쪽은 기관 표지, 오른쪽은 입력 */
export function AuthLayout({ orgName, children }: { orgName: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="grid w-full max-w-[880px] overflow-hidden rounded-3xl border border-line bg-sheet shadow-float md:grid-cols-[340px_1fr]">
        <div className="relative flex flex-col justify-between gap-12 overflow-hidden bg-navy px-9 py-10 text-white">
          <LogoMark variant="full" className="size-16" />
          <div className="relative z-10">
            <p className="text-[44px] leading-none font-extrabold tracking-[-0.05em]">이수모아</p>
            <p className="mt-3 text-[15px] text-balance text-white/75">법정교육 이수증을 모으고, 확인하고, 현황을 봅니다</p>
            {orgName && <p className="mt-5 inline-block rounded-full bg-white/12 px-3.5 py-1.5 text-[14px] font-semibold">{orgName}</p>}
          </div>
          <ul className="grid w-fit grid-cols-8 gap-1.5" aria-hidden>
            {CELLS.map((kind, i) => (
              <li
                key={i}
                className={
                  kind === 'full'
                    ? 'size-4 rounded-[4px] bg-white/85'
                    : kind === 'half'
                      ? 'size-4 rounded-[4px] bg-[linear-gradient(135deg,rgb(255_255_255/0.7)_50%,rgb(255_255_255/0.15)_50%)]'
                      : 'size-4 rounded-[4px] ring-1 ring-white/35 ring-inset'
                }
              />
            ))}
          </ul>
        </div>
        <div className="px-8 py-10 md:px-12">{children}</div>
      </div>
    </div>
  );
}
