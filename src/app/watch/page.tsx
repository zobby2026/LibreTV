'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { SwitchSourceModal } from '@/components/switch-source';
import { SkipMarkPanel } from '@/components/skip-mark-panel';
import { skipMarkKey, validateSegment, type SkipSegment } from '@/lib/skip-marks';
import type { PlayerSkipApi } from '@/components/player-shell';
import { useToast } from '@/components/toast';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore } from '@/lib/store';
import { qualityKey } from '@/lib/quality';
import {
  clearProgress,
  progressKeyOf,
  saveProgress,
  updateHistoryProgress,
  upsertHistory,
  db,
} from '@/lib/db';
import { cn } from '@/lib/utils';
import { DecisionCard } from '@/components/decision-card';

/**
 * 播放页（新版影展暗黑玻璃风格）：
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchContent />
    </Suspense>
  );
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const store = useAppStore();
  const { verified } = useAuth();
  const { toast } = useToast();

  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;

  const [reversed, setReversed] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [skipPanelOpen, setSkipPanelOpen] = useState(false);
  const playerApiRef = useRef<PlayerSkipApi | null>(null);
  const playerFrameRef = useRef<HTMLDivElement | null>(null);
  const [sheetMaxHeight, setSheetMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!skipPanelOpen) return;
    const measure = () => {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setSheetMaxHeight(undefined);
        return;
      }
      const box = playerFrameRef.current?.getBoundingClientRect();
      if (!box) {
        setSheetMaxHeight(undefined);
        return;
      }
      const viewport = window.visualViewport?.height ?? window.innerHeight;
      const room = viewport - box.bottom - 12;
      setSheetMaxHeight(Math.round(Math.max(160, Math.min(viewport * 0.6, room))));
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [skipPanelOpen]);

  const source = resolveSource(store, sourceKey, {
    url: searchParams.get('sourceUrl') || undefined,
    detail: searchParams.get('detail') || undefined,
  });

  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && vodId && verified),
    staleTime: 5 * 60_000,
  });

  const episodes = useMemo(() => detailQuery.data?.episodes ?? [], [detailQuery.data]);
  const videoTitle = titleParam || detailQuery.data?.videoInfo?.title || '未知视频';

  const currentUrl = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(Math.max(indexParam, 0), episodes.length - 1);
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) return Math.min(Math.max(indexParam, 0), episodes.length - 1);
    return indexParam;
  }, [episodes, indexParam]);

  const skipMarkFallback = `${sourceKey}:${vodId || currentUrl}`;
  const markKey = useMemo(
    () => skipMarkKey(videoTitle, skipMarkFallback),
    [videoTitle, skipMarkFallback]
  );
  const skipMark = store.skipMarks[markKey];
  const markedCount = skipMark?.segments.length ?? 0;

  const [pendingStart, setPendingStart] = useState<number | null>(null);
  useEffect(() => setPendingStart(null), [sourceKey, vodId, currentIndex]);

  const goEpisode = useCallback(
    (index: number) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams, episodes, directUrl]
  );

  const getRestorePosition = useCallback(async () => {
    const urlPos = parseInt(searchParams.get('position') || '0', 10) || 0;
    if (urlPos > 0) return urlPos;
    if (!vodId) return 0;
    const entry = await db.progress.get(progressKeyOf(sourceKey, vodId, currentIndex));
    return entry?.position ?? 0;
  }, [searchParams, sourceKey, vodId, currentIndex]);

  useEffect(() => {
    if (!verified || !sourceKey || !currentUrl) return;
    const timer = setTimeout(() => {
      upsertHistory({
        sourceKey,
        sourceUrl: source?.url,
        vodId: vodId || currentUrl,
        title: videoTitle,
        pic: detailQuery.data?.videoInfo?.cover,
        episodeIndex: currentIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, sourceKey, vodId, currentIndex, videoTitle, currentUrl]);

  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (vodId) {
        saveProgress(sourceKey, vodId, currentIndex, position, duration).catch(() => {});
        updateHistoryProgress(sourceKey, vodId || currentUrl, position, duration).catch(() => {});
      }
    },
    [sourceKey, vodId, currentIndex, currentUrl]
  );

  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
  }, []);

  const handleEnded = useCallback(() => {
    if (vodId) clearProgress(sourceKey, vodId, currentIndex).catch(() => {});
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      autoNextTimer.current = setTimeout(() => goEpisode(currentIndex + 1), 800);
    }
  }, [store.autoplayNext, currentIndex, episodes.length, goEpisode, sourceKey, vodId]);

  const handleRecordSegment = useCallback(
    (segment: SkipSegment) => {
      const duration = playerApiRef.current?.getDuration() ?? 0;
      const existing = useAppStore.getState().skipMarks[markKey]?.segments ?? [];
      const error = validateSegment(segment, duration, existing);
      if (error) {
        toast(error, 'error');
        return;
      }
      useAppStore.getState().setSkipMark(markKey, [...existing, segment]);
      const label =
        segment.type === 'opening' ? '片头结束' : segment.type === 'ending' ? '片尾开始' : '中段片段';
      const hint =
        segment.type === 'middle'
          ? useAppStore.getState().autoSkipSegments
            ? '，命中时将自动跳过'
            : '，命中时显示跳过按钮'
          : '';
      toast(`已记录${label}${hint}`, 'success');
    },
    [markKey, toast]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < episodes.length - 1) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, episodes.length, goEpisode]);

  const orderedEpisodes = reversed ? [...episodes].map((_, i) => episodes.length - 1 - i) : episodes.map((_, i) => i);

  if (!verified) {
    return (
      <div className="cinema-app flex min-h-screen items-center justify-center text-[#f3efe6]">
        <p className="font-mono text-xs text-white/50">等待访问验证...</p>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="cinema-app flex min-h-screen items-center justify-center px-4 text-[#f3efe6]">
        <div className="glass max-w-md rounded-3xl p-6 text-center">
          <h1 className="mb-2 font-serif text-lg font-bold">点播源不存在</h1>
          <p className="mb-5 text-xs leading-relaxed text-white/60">
            该视频来自点播源「{sourceKey}」，但它可能已被删除。请在设置中重新添加后重试。
          </p>
          <Link
            href="/"
            className="inline-block rounded-full px-5 py-2 text-xs font-semibold text-[#08090b]"
            style={{ background: 'var(--a)' }}
          >
            返回影展首页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cinema-app relative flex min-h-screen flex-col text-[#f3efe6]">
      <div id="glow" style={{ backgroundColor: 'var(--a)' }} />

      {/* 毛玻璃顶栏 */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#08090b]/85 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2.5 px-3 lg:px-6">
          <BackButton />
          <HomeButton />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-sm font-bold text-[#f3efe6] lg:text-base">{videoTitle}</h1>
            <p className="font-mono text-[11px] text-white/45">
              {source.name}
              {episodes.length > 0 && ` · 第 ${currentIndex + 1}/${episodes.length} 集`}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="glass rounded-full px-3 py-1.5 text-xs text-white/85 transition hover:bg-white/15 active:scale-95"
              onClick={() => {
                if (!currentUrl) return;
                enqueueDownload({
                  url: currentUrl,
                  title: `${videoTitle}${episodes.length > 1 ? ` 第${currentIndex + 1}集` : ''}`,
                  format: 'MP4',
                });
              }}
            >
              下载
            </button>
            <button
              type="button"
              className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-[#08090b] transition active:scale-95"
              style={{ background: 'var(--a)' }}
              onClick={() => setSwitchOpen(true)}
            >
              换源
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-0 pb-10 pt-0 sm:px-4 sm:pt-4 lg:px-6 lg:pt-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div>
            {/* 播放器主框 */}
            <div
              ref={playerFrameRef}
              className="aspect-video overflow-hidden bg-black shadow-2xl sm:rounded-2xl sm:border sm:border-white/10"
            >
              {currentUrl ? (
                <PlayerShell
                  url={currentUrl}
                  title={videoTitle}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  skipMark={skipMark}
                  autoSkipSegments={store.autoSkipSegments}
                  volumeBoost={store.volumeBoost}
                  pendingStart={pendingStart}
                  onPendingStart={setPendingStart}
                  onPlayerApi={(api) => { playerApiRef.current = api; }}
                  onRecordSegment={handleRecordSegment}
                  episodeKey={`${sourceKey}:${vodId}:${currentIndex}`}
                  nextUrl={currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={handleProgress}
                  onPause={handleProgress}
                  onEnded={handleEnded}
                  hasPrevEpisode={currentIndex > 0}
                  hasNextEpisode={episodes.length > 0 && currentIndex < episodes.length - 1}
                  onPrevEpisode={() => goEpisode(currentIndex - 1)}
                  onNextEpisode={() => goEpisode(currentIndex + 1)}
                  onQuality={(height) => {
                    if (!sourceKey || !vodId) return;
                    useAppStore.getState().setQuality({
                      [qualityKey(sourceKey, vodId)]: { height, from: 'play', timestamp: Date.now() },
                    });
                  }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {detailQuery.isLoading ? (
                    <Spinner size="lg" />
                  ) : (
                    <p className="font-mono text-xs text-white/50">
                      {detailQuery.isError ? '视频加载失败，请尝试切换资源' : '无可用播放地址'}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-4 sm:px-0">
              {/* 胶囊操作栏 */}
              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="glass rounded-full px-3.5 py-1.5 text-xs text-white/85 transition hover:bg-white/15 disabled:opacity-35"
                  disabled={currentIndex <= 0}
                  onClick={() => goEpisode(currentIndex - 1)}
                >
                  ‹ 上一集
                </button>
                <button
                  type="button"
                  className="glass rounded-full px-3.5 py-1.5 text-xs text-white/85 transition hover:bg-white/15 disabled:opacity-35"
                  disabled={episodes.length === 0 || currentIndex >= episodes.length - 1}
                  onClick={() => goEpisode(currentIndex + 1)}
                >
                  下一集 ›
                </button>
                <button
                  type="button"
                  className={cn(
                    'glass rounded-full px-3.5 py-1.5 text-xs transition hover:bg-white/15',
                    skipPanelOpen ? 'border-white/30 bg-white/15 text-white' : 'text-white/80'
                  )}
                  aria-expanded={skipPanelOpen}
                  aria-haspopup="dialog"
                  onClick={() => setSkipPanelOpen((v) => !v)}
                >
                  跳过标记{markedCount > 0 ? ` (${markedCount})` : ''}
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={store.autoplayNext}
                  onClick={() => store.updateSettings({ autoplayNext: !store.autoplayNext })}
                  className="glass ml-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-white/80"
                >
                  <span>自动连播</span>
                  <span
                    className="inline-block h-2 w-2 rounded-full transition-colors"
                    style={{ background: store.autoplayNext ? 'var(--a)' : 'rgba(255,255,255,.25)' }}
                  />
                </button>
              </div>

              <SkipMarkPanel
                open={skipPanelOpen}
                onClose={() => setSkipPanelOpen(false)}
                markKey={markKey}
                pendingStart={pendingStart}
                onPendingStart={setPendingStart}
                mobileMaxHeight={sheetMaxHeight}
                getPlayerClock={() => {
                  const api = playerApiRef.current;
                  if (!api) return null;
                  return {
                    currentTime: api.getCurrentTime(),
                    duration: api.getDuration(),
                    seek: (s) => api.seek(s),
                    pause: () => api.pause(),
                    isPaused: () => api.isPaused(),
                  };
                }}
              />

              {/* 30 秒 AI 决策卡（三层缓存直出） */}
              {videoTitle && videoTitle !== '未知视频' && (
                <DecisionCard
                  title={videoTitle}
                  year={detailQuery.data?.videoInfo?.year}
                  overview={detailQuery.data?.videoInfo?.desc}
                  compact
                />
              )}
            </div>
          </div>

          {/* 暗黑玻璃剧集侧栏 */}
          <aside className="mx-4 h-fit rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md sm:mx-0">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-serif text-sm font-bold text-[#f3efe6]">
                选集{episodes.length > 0 && <span className="ml-1.5 font-mono text-xs font-normal text-white/45">({episodes.length})</span>}
              </h2>
              {episodes.length > 1 && (
                <button
                  type="button"
                  className="glass inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-white/75 hover:bg-white/15"
                  onClick={() => setReversed((v) => !v)}
                  aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                >
                  <Icon
                    name="arrowDown"
                    className={cn('h-3 w-3 transition-transform', reversed && 'rotate-180')}
                  />
                  {reversed ? '正序' : '倒序'}
                </button>
              )}
            </div>
            {episodes.length === 0 ? (
              detailQuery.isLoading ? (
                <LoadingState />
              ) : (
                <EmptyState variant="plain" title={detailQuery.isError ? '获取剧集失败' : '暂无剧集信息'} />
              )
            ) : (
              <div className="scrollbar-thin grid max-h-[62vh] grid-cols-5 gap-2 overflow-y-auto pr-1 lg:grid-cols-4">
                {orderedEpisodes.map((realIndex) => (
                  <EpisodeButton
                    key={realIndex}
                    index={realIndex}
                    active={realIndex === currentIndex}
                    onClick={() => goEpisode(realIndex)}
                  />
                ))}
              </div>
            )}
            <p className="mt-4 hidden font-mono text-[10px] leading-relaxed text-white/40 md:block">
              快捷键：空格 播放/暂停 · ←/→ 快退/快进 5s · ↑/↓ 音量 · F 全屏 · Alt+←/→ 换集
            </p>
          </aside>
        </div>
      </main>

      {switchOpen && (
        <SwitchSourceModal
          currentTitle={videoTitle}
          currentSourceKey={sourceKey}
          currentVodId={vodId}
          currentIndex={currentIndex}
          onClose={() => setSwitchOpen(false)}
        />
      )}
    </div>
  );
}

function EpisodeButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl py-2 font-mono text-xs font-medium transition-all active:scale-95',
        active ? 'text-[#08090b] shadow-lg' : 'border border-white/10 bg-white/[0.06] text-white/80 hover:bg-white/15'
      )}
      style={active ? { background: 'var(--a)' } : undefined}
    >
      {index + 1}
    </button>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
      aria-label="返回"
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}

function HomeButton() {
  return (
    <Link
      href="/"
      className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
      aria-label="回首页"
      title="回首页"
    >
      <Icon name="home" className="h-4 w-4" />
    </Link>
  );
}
