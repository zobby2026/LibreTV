'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, upsertHistory, type HistoryEntry } from '@/lib/db';
import { resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl } from '@/lib/utils';
import { SmartImage } from './smart-image';

/** 首页「继续观看」只取最近若干条，完整列表仍在顶栏历史面板 */
const CONTINUE_LIMIT = 20;

/**
 * 继续观看：本地 Dexie 观看历史的横向海报条。
 * 没有记录时整段不渲染，避免空架子占首屏。
 */
export function ContinueWatching() {
  const history = useLiveQuery(
    () => db.history.orderBy('timestamp').reverse().limit(CONTINUE_LIMIT).toArray(),
    []
  );
  if (!history || history.length === 0) return null;

  return (
    <section aria-label="继续观看" className="mb-8">
      <h2 className="text-base sm:text-lg font-semibold text-content mb-3">继续观看</h2>
      <div className="-mx-4 px-4 flex gap-3 overflow-x-auto pb-1 pt-1 scrollbar-thin snap-x snap-mandatory">
        {history.map((item) => (
          <ContinueCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function ContinueCard({ item }: { item: HistoryEntry }) {
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const [imgFailed, setImgFailed] = useState(false);
  const source = resolveSource({ customAPIs, envSources }, item.sourceKey);

  const hasPercent =
    item.playbackPosition > 10 && item.duration > 0 && item.playbackPosition < item.duration * 0.95;
  const percent = hasPercent ? Math.min(100, Math.round((item.playbackPosition / item.duration) * 100)) : 0;
  const episodeLabel = item.totalEpisodes > 1 ? `第 ${item.episodeIndex + 1} 集` : undefined;

  const href = buildWatchUrl({
    sourceKey: item.sourceKey,
    vodId: item.vodId,
    index: item.episodeIndex,
    title: item.title,
    sourceUrl: source?.url,
    detail: source?.detail,
  });

  return (
    <Link
      href={href}
      onClick={() => {
        upsertHistory({ ...item, timestamp: Date.now() }).catch(() => {});
      }}
      className="w-32 sm:w-40 shrink-0 snap-start group focus-visible:outline-none"
    >
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-chip ring-1 ring-line group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-accent/50 transition-transform">
        {item.pic && !imgFailed ? (
          <SmartImage
            url={item.pic}
            mode={imageProxyMode}
            customProxy={customImageProxy}
            alt=""
            className="w-full h-full object-cover"
            onExhausted={() => setImgFailed(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-faint text-xs px-2 text-center">
            {item.title}
          </div>
        )}
        {hasPercent && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="mt-1.5 text-sm font-medium text-content truncate" title={item.title}>
        {item.title}
      </div>
      {(episodeLabel || hasPercent) && (
        <div className="text-[11px] text-faint truncate">
          {episodeLabel}
          {episodeLabel && hasPercent ? ' · ' : ''}
          {hasPercent ? `已看 ${percent}%` : ''}
        </div>
      )}
    </Link>
  );
}
