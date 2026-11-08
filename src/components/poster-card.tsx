'use client';

import { useEffect, useState } from 'react';
import type { SearchResultItem } from '@/lib/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { compactRemarks } from '@/lib/remarks';
import { SmartImage } from './smart-image';
import { Icon } from './icon';
import type { AggregatedGroup } from './video-card';

/**
 * 海报卡：2:3 竖版封面 + 底部渐变信息层，用于移动端搜索结果与推荐位。
 *
 * 与横版 AggregatedCard 的区别：横版卡把「源名 / 备注 / 画质」摊开在右侧文字区，
 * 一屏只能放 3~4 条；海报卡把信息压到封面底部，一屏能排 9~12 张，
 * 更接近 MarcoMovie 手机端的浏览密度。多源影片点击后从底部弹出源列表，
 * 保留原来的「同名聚合、按需选源」能力。
 */
export function PosterCard({
  group,
  onOpen,
  className,
}: {
  group: AggregatedGroup;
  onOpen: (item: SearchResultItem) => void;
  className?: string;
}) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const [imgFailed, setImgFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => setImgFailed(false), [group.key]);

  const multi = group.items.length > 1;
  const remarks = compactRemarks(group.remarks);

  const activate = () => {
    if (multi) setSheetOpen(true);
    else onOpen(group.items[0]);
  };

  return (
    <>
      <div className={cn('group', className)}>
        <button
          type="button"
          onClick={activate}
          className="block w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label={multi ? `${group.name}，${group.items.length} 个来源` : group.name}
        >
          <div className="poster-frame aspect-[2/3]">
            {group.pic && !imgFailed ? (
              <SmartImage
                url={group.pic}
                mode={imageProxyMode}
                customProxy={customImageProxy}
                alt={group.name}
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                onExhausted={() => setImgFailed(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-chip">
                <Icon name="grid" className="h-7 w-7 text-faint" />
              </div>
            )}

            {/* 底部渐变：保证任意封面上标题都可读 */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

            {multi && (
              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white/90 backdrop-blur-sm">
                {group.items.length} 源
              </span>
            )}

            {remarks && (
              <span className="absolute right-1.5 top-1.5 max-w-[62%] truncate rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] leading-none text-white/80 backdrop-blur-sm">
                {remarks}
              </span>
            )}

            <div className="absolute inset-x-0 bottom-0 p-2">
              <div className="line-clamp-2 text-[13px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                {group.name}
              </div>
              {(group.year || group.typeName) && (
                <div className="mt-0.5 truncate text-[10px] text-white/60">
                  {[group.year, group.typeName].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
        </button>
      </div>

      {/* 多源选择面板：挂在与卡片平级的位置，避免 hover 缩放的 transform 影响 fixed 定位 */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-[85] flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={`${group.name} 的播放来源`}
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-xl md:rounded-2xl md:pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-content">{group.name}</h3>
                <p className="mt-0.5 text-xs text-faint">
                  {group.items.length} 个来源 · 选择要播放的源
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                aria-label="关闭"
                className="shrink-0 rounded-full p-1.5 text-faint transition-colors hover:bg-hover hover:text-content"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>

            <ul className="max-h-[52vh] space-y-2 overflow-y-auto">
              {group.items.map((item) => (
                <li key={`${item.sourceKey}_${item.vodId}`}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="flex w-full items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-content">{item.sourceName}</span>
                      <span className="mt-0.5 block truncate text-xs text-faint">
                        {item.remarks || '暂无简介'}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-accent">播放</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
