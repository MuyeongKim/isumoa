import { RotateCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { withBase } from '@/lib/base';
import { cn } from '@/lib/format';

/** 이수증 원본 쪽 이미지: 화면 맞춤 / 원래 크기, 90° 돌리기, 읽은 글자 보기 */
export function PageViewer({ pageId, pageText, caption }: { pageId: number; pageText: string; caption: string }) {
  const [fit, setFit] = useState(true);
  const [rotation, setRotation] = useState(0);
  const [showText, setShowText] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [image, setImage] = useState({ pageId: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const sideways = rotation % 180 !== 0;
  const knownImage = image.pageId === pageId && image.width > 0;
  const scale = knownImage && available.width && available.height
    ? fit ? Math.min(available.width / (sideways ? image.height : image.width), available.height / (sideways ? image.width : image.height)) : available.width / (sideways ? image.height : image.width)
    : 0;
  const width = scale * image.width;
  const height = scale * image.height;

  const tool = 'rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap text-ink-soft transition-colors hover:text-ink';
  const on = 'bg-sheet text-ink shadow-[0_1px_2px_rgb(22_27_38/0.12)]';
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-sheet">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="mr-auto min-w-0 truncate text-[13px] text-ink-soft" title={caption}>
          {caption}
        </span>
        <div className="flex rounded-lg bg-ink/[0.05] p-0.5" role="group" aria-label="보기 크기">
          <button type="button" className={cn(tool, fit && on)} aria-pressed={fit} onClick={() => setFit(true)}>
            화면 맞춤
          </button>
          <button type="button" className={cn(tool, !fit && on)} aria-pressed={!fit} onClick={() => setFit(false)}>
            크게 보기
          </button>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-ink-soft transition-colors hover:bg-ink/[0.06] hover:text-ink"
          onClick={() => setRotation((r) => r + 90)}
          aria-label="90도 돌리기"
          title="90도 돌리기"
        >
          <RotateCw className="size-4" />
        </button>
        <button
          type="button"
          className={cn('rounded-md px-2.5 py-1 text-[13px] font-medium whitespace-nowrap transition-colors', showText ? 'bg-navy-soft text-navy' : 'text-ink-soft hover:bg-ink/[0.06] hover:text-ink')}
          aria-pressed={showText}
          onClick={() => setShowText((v) => !v)}
        >
          읽은 글자
        </button>
      </div>
      <div ref={viewport} className="min-h-0 flex-1 overflow-auto bg-paper/70 p-4">
        {showText ? (
          <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">{pageText || '읽은 글자가 없습니다.'}</pre>
        ) : (
          <div className="relative mx-auto" style={scale ? { width: sideways ? height : width, height: sideways ? width : height } : undefined}>
          <img
            key={pageId}
            src={withBase(`/api/pages/${pageId}/image`)}
            alt="이수증 원본"
            className={cn(
              'animate-pop-in mx-auto block bg-white shadow-[0_2px_12px_rgb(22_27_38/0.12)] transition-transform duration-300 ease-[var(--ease-out-quint)]',
              scale ? 'absolute max-w-none' : 'w-full',
            )}
            onLoad={e => setImage({ pageId, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            style={scale ? { width, height, left: '50%', top: '50%', transform: `translate(-50%, -50%) rotate(${rotation}deg)` } : undefined}
          />
          </div>
        )}
      </div>
    </div>
  );
}
