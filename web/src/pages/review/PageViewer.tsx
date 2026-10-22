import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/format';

/** 이수증 원본 쪽 이미지: 화면 맞춤 / 원래 크기, 90° 돌리기, 읽은 글자 보기 */
export function PageViewer({ pageId, pageText, caption }: { pageId: number; pageText: string; caption: string }) {
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [showText, setShowText] = useState(false);

  const tool = 'rounded px-2 py-1 text-[12.5px] hover:bg-navy-soft';
  return (
    <div className="flex h-full min-h-0 flex-col rounded-md border border-line bg-sheet">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1.5">
        <span className="mr-auto truncate text-[12.5px] text-ink-soft" title={caption}>
          {caption}
        </span>
        <button type="button" className={cn(tool, fit && 'bg-navy-soft font-medium')} onClick={() => setFit(true)}>
          화면 맞춤
        </button>
        <button type="button" className={cn(tool, !fit && 'bg-navy-soft font-medium')} onClick={() => setFit(false)}>
          크게 보기
        </button>
        <button type="button" className={tool} onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="90도 돌리기">
          <RotateCw className="size-3.5" />
        </button>
        <button type="button" className={cn(tool, showText && 'bg-navy-soft font-medium')} onClick={() => setShowText((v) => !v)}>
          읽은 글자
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-paper/60 p-3">
        {showText ? (
          <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">{pageText || '읽은 글자가 없습니다.'}</pre>
        ) : (
          <img
            key={pageId}
            src={`/api/pages/${pageId}/image`}
            alt="이수증 원본"
            className={cn('mx-auto block bg-white shadow-sm', fit ? 'w-full max-w-[780px]' : 'w-[1600px] max-w-none')}
            style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
          />
        )}
      </div>
    </div>
  );
}
