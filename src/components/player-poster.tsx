'use client';

import { BrandMark, BrandWordmark } from './brand-mark';

/**
 * 影展播放器起播遮罩：
 * 采用横排品牌标识（左侧 Z 胶片 Logo + 右侧统一字体「zobby的影视库」），
 * 下方配微光缓冲提示，适配移动端与电脑 16:9 宽屏。
 */
export function PlayerPoster() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex select-none flex-col items-center justify-center bg-[#08090b] transition-opacity duration-300">
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--a, #e98448)' }}
      />
      <div className="relative flex flex-col items-center gap-3.5 px-4">
        <div className="flex flex-row items-center gap-3">
          <BrandMark className="h-11 w-11 shrink-0 animate-pulse drop-shadow-[0_6px_22px_rgba(233,132,72,0.38)] sm:h-12 sm:w-12" />
          <BrandWordmark className="text-xl drop-shadow-md sm:text-2xl" />
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full" style={{ background: 'var(--a, #e98448)' }} />
          <span className="font-mono text-xs font-medium tracking-wide text-[#a8a59d]">
            正在缓冲片源…
          </span>
        </div>
      </div>
    </div>
  );
}
