'use client';

import type { AggregatedGroup } from '@/lib/aggregate-results';
import { CinemaImg } from './cinema-img';

export interface DirectSourceFailure {
  sourceKey: string;
  name: string;
  timedOut?: boolean;
}

interface DirectSearchPanelProps {
  query: string;
  loading: boolean;
  settledCount: number;
  totalSources: number;
  groups: AggregatedGroup[];
  failures: DirectSourceFailure[];
  hasSources: boolean;
  onOpenGroup: (group: AggregatedGroup) => void;
  onSwitchToAi: (q: string) => void;
  onOpenSettings: () => void;
}

function toSafePoster(rawPic?: string): string {
  if (!rawPic) return '';
  if (rawPic.startsWith('/api/')) return rawPic;
  if (/^https?:\/\//i.test(rawPic)) {
    return `/api/proxy-img?url=${encodeURIComponent(rawPic)}`;
  }
  return '';
}

export function DirectSearchPanel({
  query,
  loading,
  settledCount,
  totalSources,
  groups,
  failures,
  hasSources,
  onOpenGroup,
  onSwitchToAi,
  onOpenSettings,
}: DirectSearchPanelProps) {
  const totalHits = groups.reduce((acc, g) => acc + g.items.length, 0);

  return (
    <div className="space-y-4 pb-6">
      {/* 顶部状态栏 + 一键切回 AI 影展 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-xs">
        <div className="flex items-center gap-2 text-white/80">
          {loading ? (
            <>
              <span className="inline-block h-2 w-2 animate-ping rounded-full" style={{ background: 'var(--a)' }} />
              <span>
                正在直搜「<strong className="text-[#f3efe6]">{query}</strong>」（{settledCount}/{totalSources} 个源）
              </span>
            </>
          ) : (
            <span>
              直搜「<strong className="text-[#f3efe6]">{query}</strong>」：找到{' '}
              <strong style={{ color: 'var(--a)' }}>{groups.length}</strong> 部影片 · {totalHits} 条片源
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onSwitchToAi(query)}
          className="rounded-full border border-white/15 bg-black/45 px-3 py-1 font-mono text-[11px] text-[#ffd27a] transition hover:border-white/30 hover:bg-white/10 active:scale-95"
        >
          ✦ 改用 AI 找同款 ›
        </button>
      </div>

      {/* 无可用源引导 */}
      {!hasSources && (
        <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-10 text-center">
          <p className="text-sm font-medium text-[#f3efe6]">尚未启用任何点播源</p>
          <p className="mt-1.5 text-xs text-white/50">请先在设置中勾选或添加至少一个采集站后重试</p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-4 rounded-full px-4 py-1.5 text-xs font-semibold text-[#08090b]"
            style={{ background: 'var(--a)' }}
          >
            打开设置
          </button>
        </div>
      )}

      {/* 骨架占位 */}
      {hasSources && loading && groups.length === 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-[2/3] animate-pulse rounded-xl bg-white/[0.07]" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
            </div>
          ))}
        </div>
      )}

      {/* 空结果提示 + 一键转 AI */}
      {hasSources && !loading && groups.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-12 text-center">
          <p className="text-sm font-medium text-[#f3efe6]">当前片源中未搜到「{query}」</p>
          <p className="mt-1.5 text-xs text-white/45">
            可能是关键词过于详细或包含外文译名，可删减词尾重试或让 AI 识别片名
          </p>
          <button
            type="button"
            onClick={() => onSwitchToAi(query)}
            className="mt-4 rounded-full px-4 py-2 text-xs font-semibold text-[#08090b] active:scale-95"
            style={{ background: 'var(--a)' }}
          >
            ✦ 交给 AI 影展识别推荐
          </button>
        </div>
      )}

      {/* 聚合片源海报网格 */}
      {groups.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:gap-4">
          {groups.map((group) => {
            const poster = toSafePoster(group.pic);
            const count = group.items.length;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => onOpenGroup(group)}
                className="group text-left transition-transform hover:-translate-y-0.5 active:scale-95"
              >
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10 bg-[#14171f]">
                  {poster ? (
                    <CinemaImg
                      src={poster}
                      alt={group.name}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-2 text-center font-serif text-xs text-white/35">
                      {group.name}
                    </div>
                  )}
                  <span
                    className="absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                    style={
                      count > 1
                        ? { background: 'var(--a)', color: '#08090b' }
                        : { background: 'rgba(0,0,0,0.68)', color: '#f3efe6' }
                    }
                  >
                    {count > 1 ? `${count} 个片源` : group.items[0]?.sourceName || '可播'}
                  </span>
                  {group.remarks && (
                    <span className="absolute bottom-1.5 left-1.5 max-w-[88%] truncate rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] text-[#ffd27a]">
                      {group.remarks}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 truncate text-xs font-medium text-[#f3efe6]">{group.name}</div>
                <div className="mt-0.5 truncate font-mono text-[10px] text-white/45">
                  {[group.year, group.typeName].filter(Boolean).join(' · ') || '全网片源'}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 超时/失败源小字 */}
      {failures.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-[10px] text-white/40">
          <span>{loading ? '暂未响应：' : '跳过异常源：'}</span>
          {failures.map((f) => (
            <span key={f.sourceKey} className={f.timedOut ? 'text-amber-300/60' : ''}>
              {f.timedOut ? '⏱' : '✗'} {f.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
