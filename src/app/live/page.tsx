'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { copyToClipboard } from '@/lib/clipboard';
import { Header } from '@/components/header';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
import dynamic from 'next/dynamic';
const LivePlayer = dynamic(() => import('@/components/live-player').then((m) => m.LivePlayer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <Spinner size="lg" />
    </div>
  ),
});
import { LiveChannelList, type LiveChannelItem } from '@/components/live-channel-list';
import { LiveEpgPanel } from '@/components/live-epg-panel';
import { Spinner } from '@/components/states';
import { useAuth } from '@/components/auth';
import { allLiveSources, useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SmartImage } from '@/components/smart-image';

/**
 * 直播页：左侧播放器 + 频道信息 + 节目单；右侧频道侧栏。
 * 状态由 URL 驱动（?url=&name=&group=&tvgId=&epg=），支持频道深链与刷新保持。
 * 换台路径：侧栏点击、全局 ↑↓ 键盘、播放器控制条上一台/下一台（全屏可用）。
 * 移动端侧栏为底部抽屉（右下角 FAB 呼出，选中频道后自动收起）。
 */
export default function LivePage() {
  return (
    <Suspense>
      <LiveContent />
    </Suspense>
  );
}

function LiveContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // 精确订阅所需字段：任何其他 store 变化（如测活写回）不应触发本组件重渲染
  const liveSelectedUrls = useAppStore((s) => s.liveSelectedUrls);
  const liveEnvSources = useAppStore((s) => s.liveEnvSources);
  const liveSubscriptions = useAppStore((s) => s.liveSubscriptions);
  const liveFavorites = useAppStore((s) => s.liveFavorites);
  const imageProxyMode = useAppStore((s) => s.imageProxyMode);
  const volumeBoost = useAppStore((s) => s.volumeBoost);
  const customImageProxy = useAppStore((s) => s.customImageProxy);
  const { verified } = useAuth();
  const [copied, setCopied] = useState(false);
  // 移动端在播放器下方使用双 Tab 切换「频道列表 / 节目单」，默认展示频道列表
  const [mobileTab, setMobileTab] = useState<'channels' | 'epg'>('channels');
  const [logoFailed, setLogoFailed] = useState(false);
  /** 侧栏上报的筛选排序结果（键盘换台沿此列表顺序）；ref 存储，不触发重渲染 */
  const filteredRef = useRef<LiveChannelItem[]>([]);
  /** 当前频道镜像：selectChannel 内读取最近一次播放的频道，用于记录"上一个频道" */
  const currentChannelRef = useRef<LiveChannelItem | undefined>(undefined);
  /** 上一个频道：退格键/按钮一键切回（电视遥控器 back 键习惯） */
  const lastChannelRef = useRef<LiveChannelItem | null>(null);

  // 仅聚合已启用的直播源（设置 → 直播源中的勾选状态）
  const sources = useMemo(() => {
    const selected = new Set(liveSelectedUrls);
    return allLiveSources({ liveEnvSources, liveSubscriptions }).filter((s) => selected.has(s.url));
  }, [liveSelectedUrls, liveEnvSources, liveSubscriptions]);

  // 聚合全部直播源的 M3U 解析结果（单源失败不影响整体）
  const playlistsQuery = useQuery({
    queryKey: ['livePlaylists', sources.map((s) => s.url).join('|')],
    queryFn: async () => {
      const results = await Promise.allSettled(sources.map((s) => api.livePlaylist(s.url)));
      return sources.map((source, i) => ({ source, result: results[i] }));
    },
    enabled: verified && sources.length > 0,
    staleTime: 10 * 60_000,
  });

  const { channels, groups, failedCount } = useMemo(() => {
    const list: LiveChannelItem[] = [];
    const seen = new Set<string>();
    let failed = 0;
    for (const { source, result } of playlistsQuery.data ?? []) {
      if (result.status !== 'fulfilled') {
        failed++;
        continue;
      }
      for (const c of result.value.channels) {
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        list.push({ ...c, epg: source.epg, sourceUrl: source.url });
      }
    }
    const groups = [...new Set(list.map((c) => c.group).filter((g): g is string => Boolean(g)))].sort(
      (a, b) => a.localeCompare(b, 'zh')
    );
    return { channels: list, groups, failedCount: failed };
  }, [playlistsQuery.data]);

  // 当前频道：优先取列表内完整对象（含台标），否则由 URL 参数重建
  const currentUrl = searchParams.get('url') || '';
  const currentChannel = useMemo(() => {
    const found = channels.find((c) => c.url === currentUrl);
    if (found) return found;
    if (!currentUrl) return undefined;
    return {
      id: searchParams.get('tvgId') || currentUrl,
      url: currentUrl,
      name: searchParams.get('name') || '未知频道',
      group: searchParams.get('group') || undefined,
      tvgId: searchParams.get('tvgId') || undefined,
      epg: searchParams.get('epg') || undefined,
    } as LiveChannelItem;
  }, [channels, currentUrl, searchParams]);

  useEffect(() => {
    setLogoFailed(false);
  }, [currentChannel?.url]);
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const selectChannel = useCallback(
    (c: LiveChannelItem) => {
      const cur = currentChannelRef.current;
      if (cur && cur.url !== c.url) lastChannelRef.current = cur;
      const sp = new URLSearchParams({ url: c.url, name: c.name });
      if (c.group) sp.set('group', c.group);
      if (c.tvgId) sp.set('tvgId', c.tvgId);
      if (c.epg) sp.set('epg', c.epg);
      router.replace(`/live?${sp.toString()}`, { scroll: false });
      useAppStore.getState().addLiveRecent({
        url: c.url,
        name: c.name,
        logo: c.logo,
        group: c.group,
        tvgId: c.tvgId,
        epg: c.epg,
        sourceUrl: c.sourceUrl,
      });
    },
    [router]
  );

  const handleFilteredChange = useCallback((list: LiveChannelItem[]) => {
    filteredRef.current = list;
  }, []);

  /** 沿侧栏当前筛选排序的列表顺序切上一台/下一台（循环） */
  const switchChannelByOffset = useCallback(
    (delta: 1 | -1) => {
      const list = filteredRef.current;
      if (list.length === 0) return;
      const nowUrl = new URLSearchParams(window.location.search).get('url') || '';
      const idx = list.findIndex((c) => c.url === nowUrl);
      const next =
        idx === -1 ? (delta === 1 ? 0 : list.length - 1) : (idx + delta + list.length) % list.length;
      selectChannel(list[next]);
    },
    [selectChannel]
  );

  const goPrevChannel = useCallback(() => switchChannelByOffset(-1), [switchChannelByOffset]);
  const goNextChannel = useCallback(() => switchChannelByOffset(1), [switchChannelByOffset]);

  /** 切回上一个频道（Backspace / 信息条按钮） */
  const backToPrevChannel = useCallback(() => {
    const prev = lastChannelRef.current;
    if (!prev) return;
    lastChannelRef.current = null;
    selectChannel(prev);
  }, [selectChannel]);

  // 全局键盘：↑↓ 直接切台，Backspace 切回上一个频道。
  // 输入框/列表光标导航场景让位（列表聚焦时由列表内 ↑↓ 管理光标）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isChannelKey = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Backspace';
      if (!isChannelKey) return;
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (target.closest('[data-channel-list]')) return;
      }
      e.preventDefault();
      if (e.key === 'Backspace') backToPrevChannel();
      else switchChannelByOffset(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switchChannelByOffset, backToPrevChannel]);

  const handleSelect = useCallback(
    (c: LiveChannelItem) => {
      selectChannel(c);
    },
    [selectChannel]
  );

  if (!verified) {
    return (
      <div className="min-h-screen flex flex-col pb-[4.5rem] lg:pb-0">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-faint text-sm">等待访问验证...</p>
        </div>
      </div>
    );
  }

  const logo = currentChannel?.logo;
  const isFavorite = currentChannel ? liveFavorites.includes(currentChannel.url) : false;

  return (
    <div className="cinema-app min-h-screen flex flex-col pb-24 text-[#f3efe6] lg:pb-6">
      <Header showSearch />
      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-3 sm:px-4 sm:py-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* 主栏：播放器 + 信息条 + 桌面端节目单 */}
          <div className="min-w-0">
            <div className="aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              {currentUrl ? (
                <LivePlayer
                  url={currentUrl}
                  title={currentChannel?.name || '直播'}
                  onPrevChannel={goPrevChannel}
                  onNextChannel={goNextChannel}
                  volumeBoost={volumeBoost}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black px-4 text-center">
                  <span className="live-dot" />
                  <p className="text-sm text-white/60">
                    {sources.length === 0 ? (
                      liveEnvSources.length + liveSubscriptions.length > 0
                        ? '所有直播源均已停用，请在设置中勾选启用'
                        : '直播源未配置'
                    ) : playlistsQuery.isLoading ? (
                      '频道列表加载中...'
                    ) : (
                      <>
                        <span className="lg:hidden">从下方选择一个频道开始观看</span>
                        <span className="hidden lg:inline">从右侧选择一个频道开始观看</span>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* 频道信息条 */}
            {currentChannel && (
              <div className="bg-surface-raised border border-line rounded-lg p-3 mt-3 flex items-center gap-3">
                <div className="w-10 h-10 shrink-0 rounded bg-chip flex items-center justify-center overflow-hidden">
                  {logo && !logoFailed ? (
                    <SmartImage
                      url={logo}
                      mode={imageProxyMode}
                      customProxy={customImageProxy}
                      alt=""
                      className="w-full h-full object-contain"
                      onExhausted={() => setLogoFailed(true)}
                    />
                  ) : (
                    <span className="text-xs text-faint">{currentChannel.name.slice(0, 1)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="live-dot shrink-0" />
                    <h1 className="text-sm font-semibold text-content truncate">{currentChannel.name}</h1>
                    {currentChannel.group && (
                      <span className="tag bg-chip text-faint shrink-0">{currentChannel.group}</span>
                    )}
                  </div>
                  <p className="text-xs text-faint truncate mt-0.5">{currentChannel.url}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className={cn(
                      'rounded-md p-2 transition-colors',
                      lastChannelRef.current
                        ? 'text-muted hover:text-accent hover:bg-hover'
                        : 'text-faint/40 cursor-default'
                    )}
                    aria-label="上一个频道"
                    title={lastChannelRef.current ? `上一个频道：${lastChannelRef.current.name}（Backspace）` : '暂无上一个频道'}
                    onClick={backToPrevChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 15L4 10l5-5m-5 5h10.5a5.5 5.5 0 015.5 5.5V17"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-md p-2 text-muted hover:text-accent hover:bg-hover transition-colors"
                    aria-label="上一台"
                    title="上一台（↑）"
                    onClick={goPrevChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-md p-2 text-muted hover:text-accent hover:bg-hover transition-colors"
                    aria-label="下一台"
                    title="下一台（↓）"
                    onClick={goNextChannel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                  <button
                    className={cn(
                      'rounded-md p-2 transition-colors',
                      isFavorite ? 'text-warning' : 'text-muted hover:text-warning hover:bg-hover'
                    )}
                    aria-label={isFavorite ? '取消收藏' : '收藏'}
                    title={isFavorite ? '取消收藏' : '收藏'}
                    onClick={() => useAppStore.getState().toggleLiveFavorite(currentChannel.url)}
                  >
                    <svg
                      className="w-4 h-4"
                      fill={isFavorite ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  </button>
                  <button
                    className="rounded-md p-2 text-muted hover:text-accent hover:bg-hover transition-colors"
                    aria-label="复制播放地址"
                    title="复制播放地址"
                    onClick={async () => {
                      const ok = await copyToClipboard(currentChannel.url);
                      if (ok) {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }
                    }}
                  >
                    {copied ? (
                      <span className="text-[10px] text-success">已复制</span>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* 移动端双 Tab 切换栏：默认直接显示频道列表，解决手机看不到右侧频道问题 */}
            <div className="mt-3 flex gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-1 lg:hidden">
              <button
                type="button"
                onClick={() => setMobileTab('channels')}
                className={cn(
                  'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                  mobileTab === 'channels' ? 'text-[#08090b] font-semibold' : 'text-white/65 hover:text-white'
                )}
                style={mobileTab === 'channels' ? { background: 'var(--a)' } : undefined}
              >
                频道列表{channels.length > 0 ? ` (${channels.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setMobileTab('epg')}
                className={cn(
                  'flex-1 rounded-lg py-2 text-xs font-medium transition-colors',
                  mobileTab === 'epg' ? 'text-[#08090b] font-semibold' : 'text-white/65 hover:text-white'
                )}
                style={mobileTab === 'epg' ? { background: 'var(--a)' } : undefined}
              >
                节目单
              </button>
            </div>

            {/* 节目单：桌面端常驻在播放器下方；移动端切到「节目单」Tab 时展示 */}
            {currentChannel && (
              <section
                className={cn(
                  'mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5',
                  mobileTab === 'epg' ? 'block' : 'hidden lg:block'
                )}
              >
                <h2 className="mb-2.5 text-sm font-semibold text-[#f3efe6]">节目单</h2>
                <LiveEpgPanel epgUrl={currentChannel.epg} tvgId={currentChannel.tvgId} />
              </section>
            )}
          </div>

          {/* 频道列表：桌面端居右 sticky 常驻；移动端在播放器下方直接平铺展示 */}
          <aside
            className={cn(
              'flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1219]/90',
              mobileTab === 'channels' ? 'flex h-[58vh] min-h-[360px]' : 'hidden',
              'lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-6.5rem)]'
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col">
              {playlistsQuery.isLoading && channels.length === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner size="lg" />
                </div>
              ) : (
                <LiveChannelList
                  channels={channels}
                  groups={groups}
                  currentUrl={currentUrl}
                  onSelect={handleSelect}
                  onFilteredChange={handleFilteredChange}
                />
              )}
              {(failedCount > 0 || sources.length === 0) && (
                <p className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[10px] text-white/45">
                  {sources.length === 0
                    ? liveEnvSources.length + liveSubscriptions.length > 0
                      ? '所有直播源均已停用，请在设置中勾选启用'
                      : '暂无直播源，请在设置 → 直播源中添加'
                    : `${failedCount > 0 ? `${failedCount} 个订阅拉取失败 · ` : ''}共 ${sources.length} 个已启用源`}
                </p>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
