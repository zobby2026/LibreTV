'use client';

import { ContinueWatching } from './continue-watching';
import { MediaRow, type RowSpec } from './media-row';
import { RecommendSection } from './douban-section';
import { useAppStore } from '@/lib/store';

/**
 * 首页推荐编排：继续观看 + 多分区横滑。
 *
 * 豆瓣分区是首页的固定骨架，不受「推荐源」设置影响——那套单区 chips 切片的
 * 视图（豆瓣 / 热榜）一屏只能看 50 张、还要来回点标签，不适合当首屏。
 * 例外是 Bangumi 新番：按星期放送是独立需求，仍走原 RecommendSection。
 */
const ROWS: RowSpec[] = [
  { title: '热门电影', sub: 'Now Showing', type: 'movie', tag: '热门' },
  { title: '最新上线', sub: 'New Releases', type: 'movie', tag: '最新' },
  { title: '豆瓣高分', sub: 'Top Rated', type: 'movie', tag: '豆瓣高分' },
  { title: '热门剧集', sub: 'Trending Series', type: 'tv', tag: '热门' },
  { title: '国产剧', sub: 'Chinese Drama', type: 'tv', tag: '国产剧' },
  { title: '美剧', sub: 'US Series', type: 'tv', tag: '美剧' },
  { title: '综艺', sub: 'Variety', type: 'tv', tag: '综艺' },
  { title: '纪录片', sub: 'Documentary', type: 'tv', tag: '纪录片' },
];

export function HomeSections({ onPick }: { onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;

  // 非豆瓣推荐源：保持原有单区视图，别把 Bangumi 硬塞进豆瓣分区
  if (recommendSource === 'bangumi') {
    return <RecommendSection onPick={onPick} />;
  }

  return (
    <>
      <ContinueWatching />
      <div className="mt-6">
        {ROWS.map((row) => (
          <MediaRow key={`${row.type}-${row.tag}`} spec={row} onPick={onPick} />
        ))}
      </div>
    </>
  );
}
