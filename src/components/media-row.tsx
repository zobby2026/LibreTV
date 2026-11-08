'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { SmartImage } from './smart-image';
import type { DoubanItem } from '@/lib/types';

/** 首页分区规格：标题 / 英文小标 / 豆瓣接口参数 */
export interface RowSpec {
  title: string;
  sub: string;
  type: 'movie' | 'tv';
  tag: string;
}

/**
 * 首页横滑分区（影院排片感）。
 *
 * 为什么是横滑而不是竖排网格：竖排 8 个分区 × 每区 40 张海报，首屏还看不到第二屏就要滚很久；
 * 横滑一行固定 130px 卡宽，一眼能扫完整个分区，右侧露出半张卡天然提示「还能滑」。
 *
 * 懒加载：分区进入视口前 400px 才开始请求，避免首屏一次性打 8 个豆瓣接口。
 */
export function MediaRow({ spec, onPick }: { spec: RowSpec; onPick: (title: string) => void }) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const query = useQuery({
    queryKey: ['douban', spec.type, spec.tag],
    queryFn: ({ signal }) => api.douban(spec.type, spec.tag, 0, 50, signal),
    enabled: doubanEnabled && visible,
    staleTime: 10 * 60 * 1000,
  });

  const items = query.data?.items ?? [];

  return (
    <section ref={ref} aria-label={spec.title} className="mb-7 last:mb-0">
      <div className="section-head">
        <h2 className="section-title">{spec.title}</h2>
        <span className="section-sub">{spec.sub}</span>
      </div>

      {query.isLoading ? (
        <div className="row-scroll -mx-4 px-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="w-[104px] shrink-0 animate-pulse rounded-xl bg-chip sm:w-[118px] md:w-[132px]"
              style={{ aspectRatio: '2 / 3' }}
            />
          ))}
        </div>
      ) : query.isError ? (
        <p className="rounded-lg bg-chip/60 px-3 py-4 text-xs text-faint">
          这一栏暂时加载失败，可稍后重试或在设置中关闭推荐
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg bg-chip/60 px-3 py-4 text-xs text-faint">该分类暂无内容</p>
      ) : (
        <div className="row-scroll -mx-4 px-4">
          {items.map((item) => (
            <RowPoster key={item.id} item={item} onClick={() => onPick(item.title)} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 分区海报卡：纯海报铺满 + 底部渐变压字。
 * 与搜索结果的 PosterCard 同一种视觉语言，但更窄、不显示年份与源数，
 * 因为推荐位只有片名和评分这两个可信字段。
 */
function RowPoster({ item, onClick }: { item: DoubanItem; onClick: () => void }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.cover]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={item.title}
      className="group w-[104px] shrink-0 text-left focus-visible:outline-none sm:w-[118px] md:w-[132px]"
    >
      <div className="poster-frame aspect-[2/3]">
        {item.cover && !failed ? (
          <SmartImage
            url={item.cover}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt={item.title}
            className="h-full w-full object-cover"
            onExhausted={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[11px] text-faint">
            无封面
          </div>
        )}

        {/* 底部渐变：任意封面上标题都可读 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/92 via-black/45 to-transparent" />

        {item.rating && (
          <span className="absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rating backdrop-blur-sm">
            {item.rating}
          </span>
        )}

        <div className="absolute inset-x-0 bottom-0 p-2">
          <div className="line-clamp-2 text-[12.5px] font-medium leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
            {item.title}
          </div>
        </div>
      </div>
    </button>
  );
}
