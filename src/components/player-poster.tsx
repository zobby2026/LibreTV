'use client';

import { BrandMark } from './brand-mark';
import { SITE_NAME } from '@/lib/brand';

/**
 * 影展播放器起播遮罩：
 * 纯组件渲染，零额外大图请求，居中展示网站 Logo、站点名称与微光缓冲指示。
 * 适配移动端竖屏与电脑 16:9 宽屏，彻底替代旧的 /player-poster.png。
 */
export function PlayerPoster() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#08090b] pointer-events-none select-none transition-opacity duration-300">
      {/* 顶部极淡的主题色环境光晕 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--a, #dba64a)' }}
      />
      <div className="relative flex flex-col items-center gap-3">
        <BrandMark className="h-12 w-12 animate-pulse shadow-2xl drop-shadow-[0_4px_20px_rgba(219,166,74,0.35)]" />
        <span className="font-serif text-lg font-bold tracking-wider text-[#f3efe6] drop-shadow-md">
          {SITE_NAME}
        </span>
        <div className="mt-1 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-accent" />
          <span className="font-mono text-xs font-medium tracking-wide text-[#a8a59d]">
            正在缓冲片源…
          </span>
        </div>
      </div>
    </div>
  );
}
