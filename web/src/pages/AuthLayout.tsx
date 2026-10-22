import type { ReactNode } from 'react';
import { SealMark } from '@/components/SealMark';

/** 로그인·초기 설정 화면: 왼쪽은 결재판 표지, 오른쪽은 서류 */
export function AuthLayout({ orgName, children }: { orgName: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="grid w-full max-w-[820px] overflow-hidden rounded-lg border border-line bg-sheet shadow-[0_24px_60px_-28px_rgb(20_28_46/0.45)] md:grid-cols-[300px_1fr]">
        <div className="flex flex-col justify-between gap-10 bg-navy px-8 py-9 text-white">
          <SealMark className="size-14" />
          <div>
            <p className="font-serif text-[22px] leading-snug font-semibold">{orgName || '기관 법정교육'}</p>
            <p className="mt-2 text-[13px] leading-relaxed text-gold">법정교육 이수증 종합 플랫폼</p>
          </div>
        </div>
        <div className="px-8 py-9 md:px-10">{children}</div>
      </div>
    </div>
  );
}
