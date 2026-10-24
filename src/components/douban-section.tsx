'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';
import { useInView } from './use-in-view';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 影视热榜栏目：与 /api/hot-list 的 id 一一对应 */
export const HOT_LISTS: { id: string; label: string; anchor?: string }[] = [
  { id: 'douban_movie_weekly', label: '电影周榜', anchor: 'discover-movie' },
  { id: 'douban_tv_chinese', label: '国产剧周榜', anchor: 'discover-tv' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺', anchor: 'discover-variety' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 豆瓣推荐改成多条横滑海报栏；标签全集仍留在文末「更多分类」 */
export const DOUBAN_RAILS: { type: 'movie' | 'tv'; tag: string; label: string; anchor?: string }[] = [
  { type: 'movie', tag: '热门', label: '热门电影', anchor: 'discover-movie' },
  { type: 'tv', tag: '国产剧', label: '国产剧', anchor: 'discover-tv' },
  { type: 'tv', tag: '热门', label: '热门剧集' },
  { type: 'tv', tag: '综艺', label: '综艺', anchor: 'discover-variety' },
  { type: 'movie', tag: '华语', label: '华语电影' },
  { type: 'movie', tag: '最新', label: '最新电影' },
  { type: 'tv', tag: '美剧', label: '美剧' },
  { type: 'movie', tag: '豆瓣高分', label: '豆瓣高分' },
];

/**
 * 首页推荐区：数据源仍由设置决定（豆瓣 / Bangumi / 影视热榜），只展示其中一种。
 * 呈现改为横向海报栏。前两栏立即请求，其余进入视口附近再拉，避免一次打满上游。
 * 栏目标题始终挂在文档里，顶部分类芯片可以滚到对应锚点。
 */
export function RecommendSection({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiRails onPick={onPick} />;
  if (recommendSource === 'hot-list') return <HotListRails onPick={onPick} />;
  return <DoubanRails onPick={onPick} />;
}

function HotListRails({ onPick }: { onPick: (title: string) => void }) {
  return (
    <div id="discover" className="space-y-8">
      {HOT_LISTS.map((list, index) => (
        <HotListRail key={list.id} list={list} eager={index < 2} onPick={onPick} />
      ))}
    </div>
  );
}

function HotListRail({
  list,
  eager,
  onPick,
}: {
  list: (typeof HOT_LISTS)[number];
  eager: boolean;
  onPick: (title: string) => void;
}) {
  const { ref, inView } = useInView<HTMLElement>(!eager, 0, '200px');
  const enabled = eager || inView;
  const query = useQuery({
    queryKey: ['hot-list', list.id],
    queryFn: ({ signal }) => api.hotList(list.id, signal),
    enabled,
  });
  if (!enabled) {
    return (
      <section ref={ref} id={list.anchor} aria-label={list.label} className="scroll-mt-28">
        <h2 className="text-base sm:text-lg font-semibold text-content">{list.label}</h2>
      </section>
    );
  }
  return (
    <PosterRail
      title={list.label}
      anchorId={list.anchor}
      items={query.data?.items ?? []}
      pending={query.isPending}
      error={query.isError}
      onPick={onPick}
    />
  );
}

function DoubanRails({ onPick }: { onPick: (title: string) => void }) {
  return (
    <div id="discover" className="space-y-8">
      {DOUBAN_RAILS.map((rail, index) => (
        <DoubanRail key={`${rail.type}:${rail.tag}`} rail={rail} eager={index < 2} onPick={onPick} />
      ))}
      <DoubanMore onPick={onPick} />
    </div>
  );
}

function DoubanRail({
  rail,
  eager,
  onPick,
}: {
  rail: (typeof DOUBAN_RAILS)[number];
  eager: boolean;
  onPick: (title: string) => void;
}) {
  const { ref, inView } = useInView<HTMLElement>(!eager, 0, '200px');
  const enabled = eager || inView;
  const query = useQuery({
    queryKey: ['douban', rail.type, rail.tag],
    queryFn: ({ signal }) => api.douban(rail.type, rail.tag, 0, 50, signal),
    enabled,
  });
  if (!enabled) {
    return (
      <section ref={ref} id={rail.anchor} aria-label={rail.label} className="scroll-mt-28">
        <h2 className="text-base sm:text-lg font-semibold text-content">{rail.label}</h2>
      </section>
    );
  }
  return (
    <PosterRail
      title={rail.label}
      anchorId={rail.anchor}
      items={query.data?.items ?? []}
      pending={query.isPending}
      error={query.isError}
      onPick={onPick}
    />
  );
}

/** 豆瓣标签全集：主栏之外的分类仍可从这里筛，滚到附近才请求 */
function DoubanMore({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('经典');
  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const { ref, inView } = useInView<HTMLElement>(true, 0, '200px');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
    enabled: inView,
  });

  const switchType = (next: 'movie' | 'tv') => {
    if (next === type) return;
    setType(next);
    setTag(next === 'movie' ? '经典' : '纪录片');
  };

  return (
    <section ref={ref} aria-label="更多分类" className="scroll-mt-28">
      <h2 className="text-base sm:text-lg font-semibold text-content mb-3">更多分类</h2>
      {inView && (
        <>
          <div className="flex flex-wrap gap-1.5 mb-3">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
            {tags.map((item) => (
              <ChipButton key={item} active={item === tag} onClick={() => setTag(item)}>
                {item}
              </ChipButton>
            ))}
          </div>
          {query.isError ? (
            <p className="text-sm text-faint py-6">这一栏暂时加载失败，可稍后重试</p>
          ) : query.isPending ? (
            <RailSkeleton />
          ) : (
            <PosterScroller items={query.data?.items ?? []} onPick={onPick} />
          )}
        </>
      )}
    </section>
  );
}

function BangumiRails({ onPick }: { onPick: (title: string) => void }) {
  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  return (
    <div id="discover" className="space-y-8">
      {query.isError ? (
        <p className="text-sm text-faint py-6">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isPending ? (
        <section aria-label="新番放送">
          <h2 className="text-base sm:text-lg font-semibold text-content mb-3">新番放送</h2>
          <RailSkeleton />
        </section>
      ) : (
        WEEKDAYS.map((name, index) => {
          const items = query.data?.days.find((day) => day.weekday === index + 1)?.items ?? [];
          return (
            <PosterRail
              key={name}
              title={`${name}新番`}
              items={items}
              pending={false}
              error={false}
              onPick={onPick}
            />
          );
        })
      )}
    </div>
  );
}

function PosterRail({
  title,
  anchorId,
  items,
  pending,
  error,
  onPick,
}: {
  title: string;
  anchorId?: string;
  items: DoubanItem[];
  pending: boolean;
  error: boolean;
  onPick: (title: string) => void;
}) {
  if (!pending && !error && items.length === 0) return null;
  return (
    <section id={anchorId} aria-label={title} className="scroll-mt-28">
      <h2 className="text-base sm:text-lg font-semibold text-content mb-3">{title}</h2>
      {error ? (
        <p className="text-sm text-faint py-6">这一栏暂时加载失败，可稍后重试</p>
      ) : pending ? (
        <RailSkeleton />
      ) : (
        <PosterScroller items={items} onPick={onPick} />
      )}
    </section>
  );
}

function PosterScroller({ items, onPick }: { items: DoubanItem[]; onPick: (title: string) => void }) {
  if (items.length === 0) {
    return <p className="text-sm text-faint py-6">该分类暂无推荐内容</p>;
  }
  return (
    <div className="-mx-4 px-4 flex gap-3 overflow-x-auto pb-1 pt-1 scrollbar-thin snap-x snap-mandatory">
      {items.map((item) => (
        <DoubanCard key={item.id} item={item} onClick={() => onPick(item.title)} />
      ))}
    </div>
  );
}

function RailSkeleton() {
  return (
    <div className="-mx-4 px-4 flex gap-3 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="w-32 sm:w-40 md:w-44 shrink-0">
          <div className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
          <div className="h-3 mt-2 w-3/4 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        'px-2.5 py-1 rounded-full text-xs transition-colors',
        active ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:text-content hover:bg-hover'
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn('px-3.5 py-1.5 rounded-md text-sm transition-colors', active ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
