'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { SmartImage } from './smart-image';
import { Icon } from './icon';

/**
 * 首屏主视觉（Hero）。
 *
 * 设计要点：豆瓣只提供 ~300px 宽的竖版封面，直接拉伸铺满必然糊。
 * 所以分两层——底层把同一张封面放大、重度模糊、压暗，当作「银幕散射光」，
 * 糊掉反而正确；上层放清晰的小尺寸竖版海报 + 文字。这样既拿到影院氛围，
 * 又不会牺牲封面清晰度。
 *
 * 片单按日期取模轮换，同一天进来看到的是同一部，第二天自动换。
 */
export function HeroFeature({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [offset, setOffset] = useState(0);
  const [bgFailed, setBgFailed] = useState(false);

  // queryKey / pageSize 与首页分区保持一致，共享同一份缓存，不多打一次接口
  const query = useQuery({
    queryKey: ['douban', 'movie', '热门'],
    queryFn: ({ signal }) => api.douban('movie', '热门', 0, 50, signal),
    enabled: doubanEnabled,
    staleTime: 10 * 60 * 1000,
  });

  const items = query.data?.items ?? [];
  const featured = useMemo(() => {
    if (items.length === 0) return null;
    const now = new Date();
    const seed = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate();
    return items[(seed + offset) % Math.min(items.length, 12)];
  }, [items, offset]);

  // 只有 Bangumi 新番模式保留原来的单区视图，首页主视觉一并让位
  if (!doubanEnabled || recommendSource === 'bangumi') return null;

  if (query.isLoading) {
    return (
      <section className="relative mb-8 h-[268px] overflow-hidden rounded-2xl border border-line bg-card md:h-[340px]">
        <div className="absolute inset-0 animate-pulse bg-chip/60" />
        <div className="relative flex h-full items-center gap-6 p-6 md:p-10">
          <div className="h-[129px] w-[86px] shrink-0 animate-pulse rounded-xl bg-chip sm:h-[180px] sm:w-[104px] md:h-[240px] md:w-[152px]" />
          <div className="flex-1 space-y-3">
            <div className="h-3 w-24 animate-pulse rounded bg-chip" />
            <div className="h-7 w-2/3 animate-pulse rounded bg-chip md:h-10" />
            <div className="h-3 w-40 animate-pulse rounded bg-chip" />
          </div>
        </div>
      </section>
    );
  }

  if (!featured) return null;

  return (
    <section
      aria-label="首屏主视觉"
      className="relative mb-7 overflow-hidden rounded-2xl border border-line ring-1 ring-content/[0.06]"
    >
      {/* 氛围层：模糊封面 + 多层遮罩，边缘沉入页面底色。
          必须走 SmartImage —— 豆瓣图床校验 Referer，裸 <img> 会 403 导致整块只剩纯色 */}
      <div className="hero-canvas" aria-hidden>
        {!bgFailed && (
          <SmartImage
            url={featured.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt=""
            loading="eager"
            onExhausted={() => setBgFailed(true)}
          />
        )}
      </div>

      <div className="relative flex min-h-[268px] items-center gap-4 p-5 md:gap-8 md:p-9">
        {/* 清晰竖版海报：手机上收窄但不隐藏，否则主视觉只剩文字、撑不起画面 */}
        <div className="w-[86px] shrink-0 sm:w-[104px] md:w-[152px]">
          <div className="poster-frame aspect-[2/3] ring-1 ring-content/10">
            <SmartImage
              url={featured.cover}
              mode={imageProxyMode}
              customProxy={customImageProxy}
              alt={featured.title}
              loading="eager"
              className="h-full w-full object-cover"
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-accent/70">
              今日主视觉
            </span>
            <span className="h-px w-8 bg-accent/30" />
          </div>

          <h2 className="line-clamp-2 text-[26px] font-semibold leading-tight text-content md:text-[38px]">
            {featured.title}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {featured.rating && (
              <span className="inline-flex items-baseline gap-1 rounded-md bg-black/45 px-2 py-1 text-sm font-semibold text-accent backdrop-blur-sm">
                {featured.rating}
                <span className="text-[10px] font-normal text-accent/70">分</span>
              </span>
            )}
            {/* 标签统一用半透明黑底片：Hero 背景亮度随封面变化，
                靠主题色块（bg-content/7）在浅色封面上会糊成一片，黑底片在两种主题下都稳 */}
            <span className="rounded-md bg-black/45 px-2 py-1 text-xs text-white/80 backdrop-blur-sm">
              {featured.isTv ? '剧集' : '电影'}
            </span>
            <span className="rounded-md bg-black/45 px-2 py-1 text-xs text-white/80 backdrop-blur-sm">豆瓣热门榜</span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => onPick(featured.title)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98]"
            >
              <Icon name="search" className="h-4 w-4" />
              找片源
            </button>
            <button
              type="button"
              onClick={() => setOffset((v) => v + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-content/[0.12] bg-content/[0.07] px-3.5 py-2 text-sm text-content/90 backdrop-blur-sm transition-colors hover:border-accent/40 hover:text-content"
            >
              <Icon name="refresh" className="h-4 w-4" />
              换一部
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
