'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, upsertHistory } from '@/lib/db';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { SmartImage } from './smart-image';

/**
 * 继续观看：横向滑动卡片，数据直接读本地 IndexedDB 的观看历史。
 *
 * 参考 MarcoMovie 手机端首页的「继续观看」条：只展示最近若干条，
 * 卡片里同时给出「看到第几集」和进度条，点一下直接回到上次的集数与位置，
 * 不需要先进详情页再选集。没有历史时整块不渲染，首屏不留空档。
 */
export function ContinueWatching() {
  const history = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(12).toArray(),
    []
  );
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);

  if (!history || history.length === 0) return null;

  // 源被删掉的记录无法续播，直接不展示（历史面板里仍可看到并清理）
  const items = history
    .map((entry) => ({
      entry,
      source: resolveSource({ customAPIs, envSources }, entry.sourceKey),
    }))
    .filter((x) => x.source);

  if (items.length === 0) return null;

  return (
    <section aria-label="继续观看" className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-content">继续观看</h2>
        <span className="text-[11px] text-faint">最近 {items.length} 条</span>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
        {items.map(({ entry, source }) => {
          const hasProgress =
            entry.playbackPosition > 10 &&
            entry.duration > 0 &&
            entry.playbackPosition < entry.duration * 0.95;
          const percent = hasProgress
            ? Math.max(2, Math.round((entry.playbackPosition / entry.duration) * 100))
            : 0;
          const episodeLabel =
            entry.totalEpisodes > 1 ? `第 ${entry.episodeIndex + 1} 集` : '继续播放';

          const href = buildWatchUrl({
            sourceKey: entry.sourceKey,
            vodId: entry.vodId,
            index: entry.episodeIndex,
            title: entry.title,
            sourceUrl: source?.url,
            detail: source?.detail,
          });

          return (
            <Link
              key={entry.id}
              href={href}
              onClick={() => {
                // 点击即刷新时间戳，让这条记录保持在最前
                upsertHistory({ ...entry, timestamp: Date.now() }).catch(() => {});
              }}
              className="w-[116px] shrink-0 snap-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-chip ring-1 ring-line/60">
                {entry.pic ? (
                  <SmartImage
                    url={entry.pic}
                    mode={imageProxyMode}
                    customProxy={customImageProxy}
                    alt={entry.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-chip" />
                )}

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-1.5 pb-2">
                  <div className="line-clamp-2 text-[12px] font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                    {entry.title}
                  </div>
                  <div className="mt-0.5 text-[10px] text-white/60">{episodeLabel}</div>
                </div>

                {percent > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
                    <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
