'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import type { BangumiCalendarDay, DoubanItem } from '@/lib/types';
import { SmartImage } from './smart-image';
import { DOUBAN_RAILS, HOT_LISTS, WEEKDAYS } from './douban-section';

/** 当前推荐源的首条海报，供首页 Hero 使用（与对应推荐栏共用同一查询） */
function useFeatured() {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);
  const hotId = HOT_LISTS[0].id;
  const doubanRail = DOUBAN_RAILS[0];

  const hot = useQuery({
    queryKey: ['hot-list', hotId],
    queryFn: ({ signal }) => api.hotList(hotId, signal),
    enabled: doubanEnabled && recommendSource === 'hot-list',
  });
  const douban = useQuery({
    queryKey: ['douban', doubanRail.type, doubanRail.tag],
    queryFn: ({ signal }) => api.douban(doubanRail.type, doubanRail.tag, 0, 50, signal),
    enabled: doubanEnabled && recommendSource === 'douban',
  });
  const bangumi = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
    enabled: doubanEnabled && recommendSource === 'bangumi',
  });

  if (!doubanEnabled) return { status: 'off' as const };

  if (recommendSource === 'bangumi') {
    if (bangumi.isPending) return { status: 'loading' as const };
    const picked = pickBangumi(bangumi.data?.days);
    return picked ? { status: 'ready' as const, ...picked } : { status: 'empty' as const };
  }

  const query = recommendSource === 'douban' ? douban : hot;
  const eyebrow = recommendSource === 'douban' ? doubanRail.label : HOT_LISTS[0].label;
  if (query.isPending) return { status: 'loading' as const };
  const item = firstPoster(query.data?.items);
  return item ? { status: 'ready' as const, item, eyebrow } : { status: 'empty' as const };
}

function firstPoster(items: DoubanItem[] | undefined): DoubanItem | undefined {
  return items?.find((item) => item.cover && item.title);
}

/** Bangumi 星期：JS 0=周日 … 6=周六，接口 1=周一 … 7=周日 */
function bangumiWeekday(date = new Date()): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

function pickBangumi(days: BangumiCalendarDay[] | undefined): { item: DoubanItem; eyebrow: string } | null {
  if (!days?.length) return null;
  const weekday = bangumiWeekday();
  const today = days.find((day) => day.weekday === weekday);
  const item = firstPoster(today?.items) ?? firstPoster(days.flatMap((day) => day.items));
  if (!item) return null;
  const onToday = today?.items.some((entry) => entry.id === item.id);
  return { item, eyebrow: onToday ? `${WEEKDAYS[weekday - 1]}新番` : '新番放送' };
}

/** 首页主视觉：当前热门/推荐源的第一条海报，点击走现有搜索流程 */
export function HomeHero({ onWatch }: { onWatch: (title: string) => void }) {
  const featured = useFeatured();
  if (featured.status === 'off' || featured.status === 'empty') return null;
  if (featured.status === 'loading') return <HeroSkeleton />;
  return <HeroFrame item={featured.item} eyebrow={featured.eyebrow} onWatch={onWatch} />;
}

function HeroFrame({
  item,
  eyebrow,
  onWatch,
}: {
  item: DoubanItem;
  eyebrow: string;
  onWatch: (title: string) => void;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <section aria-label="今日推荐" className="relative mb-2">
      <div className="relative h-[70vw] min-h-[300px] max-h-[520px] sm:min-h-[380px] overflow-hidden bg-page">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(80% 70% at 80% 0%, rgb(var(--c-accent) / 0.28), transparent 60%)',
          }}
        />
        {item.cover && !imgFailed && (
          <SmartImage
            url={item.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt=""
            loading="eager"
            className="absolute inset-0 w-full h-full object-cover object-[center_20%]"
            onExhausted={() => setImgFailed(true)}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgb(var(--c-page)) 0%, rgb(var(--c-page)) 22%, rgb(var(--c-page) / 0.94) 46%, rgb(var(--c-page) / 0.45) 70%, rgb(0 0 0 / 0.35) 100%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgb(var(--c-page) / 0.97) 0%, rgb(var(--c-page) / 0.72) 32%, rgb(var(--c-page) / 0.2) 58%, transparent 80%)',
          }}
        />

        <div className="absolute inset-x-0 bottom-0">
          <div className="max-w-6xl mx-auto px-4 pb-6 sm:pb-10">
            <p className="text-xs sm:text-sm font-medium text-accent mb-2">{eyebrow}</p>
            <h1 className="text-3xl sm:text-5xl font-bold text-content leading-tight max-w-3xl line-clamp-2">
              {item.title}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-muted max-w-xl">
              {item.rating ? `评分 ${item.rating} · ` : ''}
              搜索同名影片，选择片源播放
            </p>
            <button
              type="button"
              className="btn-primary mt-4 px-5 py-2.5 text-sm sm:text-base rounded-lg"
              onClick={() => onWatch(item.title)}
            >
              <PlayIcon />
              立即观看
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[70vw] min-h-[300px] max-h-[520px] sm:min-h-[380px] bg-chip animate-pulse"
    />
  );
}

function PlayIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.2-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}
