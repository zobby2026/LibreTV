'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { catalog, flattenCatalog, type CatalogEditorial, type CatalogItem, type CatalogMood } from '@/lib/catalog';
import { clearAllHistory } from '@/lib/db';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { SITE_NAME } from '@/lib/brand';
import { fetchDecisionCardCached, getCachedDecisionCard, type DecisionCardData } from '@/lib/decision-card-cache';
import { useAuth } from './auth';
import { CinemaImg } from './cinema-img';
import { ContinueWatching } from './continue-watching';
import { DecisionCard } from './decision-card';
import { SourceManagerDrawer } from './source-manager';
import { useToast } from './toast';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

const BASE_MOODS: CatalogMood[] = [
  { emoji: '🌧️', label: '深夜 emo', sub: '孤独与治愈', query: '适合深夜一个人看、情绪细腻且有治愈感的文艺电影', bg: 'linear-gradient(135deg,#1e293b,#0f172a)', slot: 'night' },
  { emoji: '🍜', label: '午休下饭', sub: '轻快不费脑', query: '适合吃饭时看、节奏轻快有趣不费脑的下饭剧或喜剧', bg: 'linear-gradient(135deg,#451a03,#1c1917)', slot: 'noon' },
  { emoji: '🤯', label: '烧脑反转', sub: '高能悬疑', query: '结局反转惊艳、逻辑严密的高能悬疑烧脑电影或短剧', bg: 'linear-gradient(135deg,#312e81,#0f172a)', slot: 'any' },
  { emoji: '🍿', label: '周末狂欢', sub: '大屏爽片', query: '适合周末晚上窝在沙发上看的节奏爽快高分大片', bg: 'linear-gradient(135deg,#064e3b,#022c22)', slot: 'weekend' },
  { emoji: '💎', label: '高分冷门', sub: '私藏佳片', query: '豆瓣8.2分以上冷门小众、质感高级的私藏佳片', bg: 'linear-gradient(135deg,#4c1d95,#1e1b4b)', slot: 'any' },
  { emoji: '😂', label: '爆笑解压', sub: '电子布洛芬', query: '笑点密集、不尴尬、看完烦恼清空的高分喜剧片', bg: 'linear-gradient(135deg,#713f12,#1c1917)', slot: 'weekend' },
  { emoji: '💔', label: '痛快哭一场', sub: '后劲极大', query: '情感真挚克制、让人忍不住流泪且后劲极大的催泪佳作', bg: 'linear-gradient(135deg,#4c0519,#1c0a12)', slot: 'night' },
  { emoji: '🚀', label: '科幻奇观', sub: '脑洞宇宙', query: '想象力惊人、视听震撼的高分硬核科幻电影', bg: 'linear-gradient(135deg,#0c4a6e,#082032)', slot: 'any' },
  { emoji: '🔍', label: '硬核探案', sub: '抽丝剥茧', query: '抽丝剥茧、细节拉满的高分犯罪推理探案剧或电影', bg: 'linear-gradient(135deg,#1e3a5f,#0b1320)', slot: 'any' },
  { emoji: '🌸', label: '温柔日常', sub: '慢节奏治愈', query: '画面干净温柔、讲述生活微光的日系或华语治愈片', bg: 'linear-gradient(135deg,#500724,#1f1024)', slot: 'noon' },
  { emoji: '🎞️', label: '复古港风', sub: '黄金年代', query: '氛围浓郁、光影迷人的经典港片或怀旧年代佳作', bg: 'linear-gradient(135deg,#3f2e18,#18120b)', slot: 'night' },
  { emoji: '🛋️', label: '懒人放空', sub: '无脑放松', query: '不需要动脑、轻松愉快、适合躺平放空看的剧或电影', bg: 'linear-gradient(135deg,#134e4a,#071e1c)', slot: 'weekend' },
];

const PLACEHOLDERS = [
  '想看一部看完不想说话的片',
  '适合周末晚上边吃外卖边看的轻喜剧',
  '像《黑镜》一样细思极恐的反转剧',
  '雨夜、爵士乐与孤独灵魂的文艺片',
];

const PALETTE = [
  '#e86f51', '#5ea8ff', '#f4a261', '#b28cff', '#4ecdc4',
  '#ff6b8b', '#ffd27a', '#7ae582', '#ff8c42', '#6ee7ff',
];

const FASTEST_SOURCES_KEY = 'libretv_fastest_sources';
const SOURCE_TIMEOUT_MS = 3000;

interface Pick { t: string; y: number; w: string }
interface HitItem extends Pick {
  s: number;
  match: number;
  poster: string;
  backdrop?: string;
  a: string;
  hits: SearchResultItem[];
}

const CATALOG_FLAT = flattenCatalog(catalog);

function hashColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 列表/瀑布流统一降载为 w342，严禁加载 original 原图 */
function toListPoster(url?: string): string {
  if (!url) return '';
  return url
    .replace('/api/img/original/', '/api/img/w342/')
    .replace('/api/img/w500/', '/api/img/w342/')
    .replace('/api/img/w780/', '/api/img/w342/');
}

/** 轮播/详情氛围图最多加载 w780，严禁 original 原图 */
function toHeroMedia(url?: string): string {
  if (!url) return '';
  return url.replace('/api/img/original/', '/api/img/w780/');
}

/** 根据片名优先匹配片库内 TMDB/豆瓣反代海报，未命中则走 /api/proxy-img 转 HTTPS 防裂图 */
function resolveSafeMedia(title: string, rawPic?: string): { poster: string; backdrop?: string; a: string } {
  const cleanTitle = title.trim();
  const matched =
    CATALOG_FLAT.find((m) => m.t === cleanTitle) ||
    CATALOG_FLAT.find((m) => m.t.includes(cleanTitle) || cleanTitle.includes(m.t));

  if (matched) {
    return {
      poster: toListPoster(matched.poster),
      backdrop: toHeroMedia(matched.backdrop || matched.poster),
      a: matched.a || hashColor(cleanTitle),
    };
  }

  let poster = '';
  if (rawPic) {
    if (rawPic.startsWith('/api/')) {
      poster = toListPoster(rawPic);
    } else if (/^https?:\/\//i.test(rawPic)) {
      poster = `/api/proxy-img?url=${encodeURIComponent(rawPic)}`;
    }
  }
  return {
    poster,
    backdrop: poster,
    a: hashColor(cleanTitle),
  };
}

function readFastestSources(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(FASTEST_SOURCES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function recordSourceSpeed(sourceKey: string, ms: number): void {
  if (typeof window === 'undefined' || !sourceKey || !Number.isFinite(ms)) return;
  try {
    const current = readFastestSources();
    const prev = current[sourceKey];
    current[sourceKey] = prev ? Math.round(prev * 0.6 + ms * 0.4) : Math.round(ms);
    localStorage.setItem(FASTEST_SOURCES_KEY, JSON.stringify(current));
  } catch {
    /* 隐私模式静默跳过 */
  }
}

function sortSourcesBySpeed(sources: SourceConfig[]): SourceConfig[] {
  const speeds = readFastestSources();
  return [...sources].sort((a, b) => {
    const sa = speeds[a.key] ?? Number.MAX_SAFE_INTEGER;
    const sb = speeds[b.key] ?? Number.MAX_SAFE_INTEGER;
    return sa - sb;
  });
}

/** 全端响应式 AI 影展（手机底部 Dock + 电脑顶部导航与宽屏适配）。 */
export function CinemaHome({ initialTab = 'home' }: { initialTab?: 'home' | 'library' }) {
  const router = useRouter();
  const { user, verified, isAdmin, openLogin, logout } = useAuth();
  const { toast } = useToast();
  const hero = catalog.hero || [];
  const boards = catalog.boards || [];
  const [tab, setTab] = useState<'home' | 'library' | 'live'>(initialTab);
  const [heroIdx, setHeroIdx] = useState(0);
  const [fullBoard, setFullBoard] = useState<(typeof boards)[number] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState(PLACEHOLDERS[0]);
  const railRef = useRef<HTMLDivElement>(null);
  const [quick, setQuick] = useState<CatalogItem | null>(null);
  const [quickCard, setQuickCard] = useState<DecisionCardData | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const longTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchStep, setSearchStep] = useState(-1);
  const [stepperExpanded, setStepperExpanded] = useState(false);
  const [intro, setIntro] = useState('');
  const [results, setResults] = useState<HitItem[]>([]);
  const [filteredOut, setFilteredOut] = useState<string[]>([]);
  const curateRunId = useRef(0);

  const [active, setActive] = useState<CatalogItem | HitItem | null>(null);
  const [hits, setHits] = useState<SearchResultItem[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);

  const selectedSources = useSelectedSources();
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const adFilter = useAppStore((s) => s.adFilter);
  const autoplayNext = useAppStore((s) => s.autoplayNext);
  const autoSkipSegments = useAppStore((s) => s.autoSkipSegments);
  const volumeBoost = useAppStore((s) => s.volumeBoost);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const liveCount = useAppStore((s) => s.liveEnvSources.length + s.liveSubscriptions.length);

  const searchLead = results[0];
  const accent = (searchOpen && searchLead?.a) || hero[heroIdx]?.a || '#e86f51';

  useEffect(() => {
    document.documentElement.style.setProperty('--a', accent);
  }, [accent]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (window.scrollY >= 60 || tab !== 'home' || searchOpen || !railRef.current || hero.length < 2) return;
      const rail = railRef.current;
      const next = (heroIdx + 1) % hero.length;
      rail.scrollTo({ left: next * rail.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => window.clearInterval(id);
  }, [heroIdx, hero.length, searchOpen, tab]);

  useEffect(() => {
    let sIdx = 0;
    let cIdx = 0;
    let deleting = false;
    const id = window.setInterval(() => {
      if (query) return;
      const target = PLACEHOLDERS[sIdx];
      if (!deleting) {
        cIdx += 1;
        setPlaceholder(target.slice(0, cIdx));
        if (cIdx >= target.length) deleting = true;
      } else {
        cIdx -= 1;
        setPlaceholder(target.slice(0, Math.max(0, cIdx)));
        if (cIdx <= 0) {
          deleting = false;
          sIdx = (sIdx + 1) % PLACEHOLDERS.length;
        }
      }
    }, 110);
    return () => window.clearInterval(id);
  }, [query]);

  const [moodPage, setMoodPage] = useState(0);
  const [selectedMoods, setSelectedMoods] = useState<CatalogMood[]>([]);
  const [timeSlot, setTimeSlot] = useState<'noon' | 'night' | 'weekend' | 'any'>('any');

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    if (hour >= 11 && hour < 14) setTimeSlot('noon');
    else if (hour >= 22 || hour < 4) setTimeSlot('night');
    else if (day === 0 || day === 6 || (day === 5 && hour >= 18)) setTimeSlot('weekend');
    else setTimeSlot('any');
  }, []);

  const moodPool = useMemo(() => {
    const daily = catalog.moods || [];
    const seen = new Set<string>();
    const merged: CatalogMood[] = [];
    for (const m of [...daily, ...BASE_MOODS]) {
      if (seen.has(m.label)) continue;
      seen.add(m.label);
      merged.push(m);
    }
    if (timeSlot === 'any') return merged;
    const matchIdx = merged.findIndex((m) => !m.hot && m.slot === timeSlot);
    if (matchIdx <= 0) return merged;
    const copy = [...merged];
    const [picked] = copy.splice(matchIdx, 1);
    copy.unshift(picked);
    return copy;
  }, [timeSlot]);

  const visibleMoods = useMemo(() => {
    const size = 5;
    if (moodPool.length <= size) return moodPool;
    const start = (moodPage * size) % moodPool.length;
    const out: CatalogMood[] = [];
    for (let i = 0; i < size; i += 1) {
      out.push(moodPool[(start + i) % moodPool.length]);
    }
    return out;
  }, [moodPool, moodPage]);

  const toggleMood = (mood: CatalogMood) => {
    setSelectedMoods((prev) => {
      if (prev.some((m) => m.label === mood.label)) {
        return prev.filter((m) => m.label !== mood.label);
      }
      if (prev.length >= 2) {
        return [prev[1], mood];
      }
      return [...prev, mood];
    });
  };

  const searchCombinedMoods = () => {
    if (selectedMoods.length === 0) return;
    const prompt =
      selectedMoods.length === 1
        ? selectedMoods[0].query || `${selectedMoods[0].label}（${selectedMoods[0].sub}）`
        : `同时兼具「${selectedMoods[0].label}（${selectedMoods[0].sub}）」和「${selectedMoods[1].label}（${selectedMoods[1].sub}）」两种情绪氛围的高分影视`;
    setSelectedMoods([]);
    startSearch(prompt);
  };

  const feedItems = useMemo(() => buildFeedFlat(boards, hero, catalog.editorials), [boards, hero]);

  const onHeroScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const i = Math.round(rail.scrollLeft / Math.max(rail.clientWidth, 1));
    if (i !== heroIdx && hero[i]) {
      setHeroIdx(i);
    }
  };

  const scrollHeroTo = (idx: number) => {
    const rail = railRef.current;
    if (!rail) return;
    const target = ((idx % hero.length) + hero.length) % hero.length;
    setHeroIdx(target);
    rail.scrollTo({ left: target * rail.clientWidth, behavior: 'smooth' });
  };

  const startSearch = (q: string) => {
    const text = q.trim();
    if (!text) return;
    const runId = ++curateRunId.current;
    setQuery(text);
    setSearchOpen(true);
    setSearchStep(0);
    setStepperExpanded(false);
    setIntro('');
    setResults([]);
    setFilteredOut([]);
    void runCurate(text, selectedSources, yellowFilter, {
      isStale: () => curateRunId.current !== runId,
      onStep: setSearchStep,
      onIntro: setIntro,
      onUpsertResult: (item) => {
        setResults((prev) => {
          const idx = prev.findIndex((p) => p.t === item.t);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = item;
            return next;
          }
          return [...prev, item].sort((a, b) => b.match - a.match);
        });
      },
      onDone: (missing) => {
        setFilteredOut(missing);
        setSearchStep(4);
      },
    });
  };

  const openQuick = (movie: CatalogItem) => {
    setQuick(movie);
    const cached = getCachedDecisionCard(movie.t, movie.y);
    if (cached) {
      setQuickCard(cached);
      setQuickLoading(false);
      return;
    }
    setQuickCard(null);
    setQuickLoading(true);
    void fetchDecisionCardCached({ title: movie.t, year: movie.y, overview: movie.w || '' })
      .then((data) => { if (data?.p) setQuickCard(data); })
      .finally(() => setQuickLoading(false));
  };

  const openDetail = async (movie: CatalogItem | HitItem) => {
    setActive(movie);
    setHits('hits' in movie ? movie.hits : []);
    if ('hits' in movie && movie.hits.length) return;
    setHitsLoading(true);
    try {
      const found = await searchTitleFast(movie.t, selectedSources, yellowFilter, {
        onProgress: (partial) => setHits(partial),
      });
      setHits(found);
    } finally {
      setHitsLoading(false);
    }
  };

  const play = (item: SearchResultItem) => {
    router.push(buildWatchUrl({
      sourceKey: item.sourceKey,
      vodId: item.vodId,
      title: item.name,
      sourceUrl: item.sourceUrl,
    }));
  };

  const closeSearch = () => {
    curateRunId.current += 1;
    setSearchOpen(false);
  };

  return (
    <div className="cinema-app relative min-h-screen pb-24 text-[#f3efe6] lg:pb-14">
      <div id="glow" style={{ backgroundColor: accent }} />

      {/* 桌面端顶部毛玻璃导航栏 */}
      <header className="sticky top-0 z-30 hidden border-b border-white/10 bg-[#08090b]/80 backdrop-blur-2xl lg:block">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-6">
          <button
            type="button"
            onClick={() => { setSearchOpen(false); setTab('home'); }}
            className="flex shrink-0 items-center gap-2 text-left"
          >
            <span className="text-lg" style={{ color: 'var(--a)' }}>✦</span>
            <span className="font-serif text-lg font-bold tracking-tight">{SITE_NAME}</span>
          </button>

          <nav className="flex items-center gap-1 text-sm">
            {([
              { id: 'home', label: '影展' },
              { id: 'library', label: '片库' },
              { id: 'live', label: '直播' },
            ] as const).map((nav) => (
              <button
                key={nav.id}
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  if (nav.id === 'live' && liveCount > 0) {
                    router.push('/live');
                  } else {
                    setTab(nav.id);
                  }
                }}
                className={`rounded-full px-4 py-1.5 transition-colors ${
                  tab === nav.id ? 'bg-white/12 font-medium text-white' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
                style={tab === nav.id ? { color: 'var(--a)' } : undefined}
              >
                {nav.label}
              </button>
            ))}
          </nav>

          <form
            className="aur ml-auto w-full max-w-md"
            onSubmit={(e) => { e.preventDefault(); startSearch(query); }}
          >
            <div className="flex items-center gap-2 rounded-[18.5px] bg-[#0d0f14] px-3.5 py-1.5">
              <span className="text-xs" style={{ color: 'var(--a)' }}>✦</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                aria-label="AI 搜索"
                className="flex-1 bg-transparent text-xs text-[#f3efe6] placeholder:text-white/40 focus:outline-none"
              />
              <button type="submit" className="rounded-xl px-3 py-1 text-xs font-medium text-[#08090b]" style={{ background: 'var(--a)' }}>
                搜索
              </button>
            </div>
          </form>

          <div className="flex shrink-0 items-center gap-2">
            {verified && user ? (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/15"
              >
                <span className="max-w-[96px] truncate font-medium">{user.username}</span>
                <span
                  className="rounded-full px-1.5 py-0.5 font-mono text-[10px]"
                  style={isAdmin ? { background: 'var(--a)', color: '#08090b' } : { background: 'rgba(255,255,255,.12)' }}
                >
                  {isAdmin ? '管理员' : '访客'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={openLogin}
                className="rounded-full px-3.5 py-1.5 text-xs font-medium text-[#08090b]"
                style={{ background: 'var(--a)' }}
              >
                登录
              </button>
            )}
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="设置"
              className="glass flex h-9 w-9 items-center justify-center rounded-full text-white/75 hover:bg-white/15 hover:text-white"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-7xl lg:px-6">
        {tab === 'home' && (
          <div>
            {/* Hero 沉浸轮播：手机全屏，电脑宽屏圆角影院 */}
            <section className="relative w-full overflow-hidden h-[calc(100svh-70px)] min-h-[520px] lg:mt-5 lg:h-[500px] lg:min-h-[460px] lg:rounded-3xl lg:border lg:border-white/10">
              <div className="absolute left-3 right-3 top-3 z-30 flex gap-1 lg:left-6 lg:right-6 lg:top-5">
                {hero.map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-label={`切换到第 ${idx + 1} 部`}
                    onClick={() => scrollHeroTo(idx)}
                    className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/20"
                  >
                    <div className="h-full transition-[width] duration-300" style={{ width: idx <= heroIdx ? '100%' : '0%', background: 'var(--a)' }} />
                  </button>
                ))}
              </div>

              {hero.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="上一部"
                    onClick={() => scrollHeroTo(heroIdx - 1)}
                    className="glass absolute left-5 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-lg text-white/80 backdrop-blur-md transition hover:bg-white/20 lg:flex"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="下一部"
                    onClick={() => scrollHeroTo(heroIdx + 1)}
                    className="glass absolute right-5 top-1/2 z-30 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-lg text-white/80 backdrop-blur-md transition hover:bg-white/20 lg:flex"
                  >
                    ›
                  </button>
                </>
              )}

              <div
                ref={railRef}
                onScroll={onHeroScroll}
                className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto"
              >
                {hero.map((m, idx) => (
                  <div
                    key={m.id}
                    className="relative flex h-full w-full flex-shrink-0 snap-center flex-col justify-end px-5 pb-24 lg:flex-row lg:items-end lg:justify-between lg:px-16 lg:pb-12"
                    style={{ background: `linear-gradient(180deg, ${m.a}33 0%, ${m.b} 100%)` }}
                  >
                    {(m.backdrop || m.poster) && (
                      <CinemaImg
                        src={toHeroMedia(m.backdrop || m.poster)}
                        fetchPriority={idx === 0 ? 'high' : undefined}
                        loading={idx === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-55"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#08090b] via-[#08090b]/45 to-transparent lg:bg-gradient-to-r lg:from-[#08090b]/90 lg:via-[#08090b]/45 lg:to-transparent" />
                    <div className="relative z-10 max-w-xl">
                      <div className="rank-stroke -mb-6 select-none font-mono">{idx + 1}</div>
                      <div className="mb-1.5 flex items-center gap-2 font-mono text-xs">
                        <span className="rounded border border-white/10 bg-black/50 px-2 py-0.5 text-[#ffd27a]">★ {m.r}</span>
                        <span className="text-white/60">{m.d} · {m.ty}</span>
                      </div>
                      <h1 className="mb-2 font-serif text-[34px] font-bold leading-tight tracking-tight lg:text-5xl">{m.t}</h1>
                      <p className="mb-5 line-clamp-2 font-mono text-xs leading-relaxed text-[#f3efe6]/80 lg:text-sm">AI ▸ {m.ai || m.w}</p>
                      <div className="flex items-center gap-2.5">
                        <button type="button" onClick={() => void openDetail(m)} className="rounded-full px-5 py-2 text-xs font-medium text-[#08090b] active:scale-95 lg:text-sm" style={{ background: 'var(--a)' }}>
                          ▶ 找片源
                        </button>
                        <button type="button" onClick={() => openQuick(m)} className="glass rounded-full px-4 py-2 text-xs text-white/85 hover:bg-white/15 lg:text-sm">
                          ✦ 30 秒决策卡
                        </button>
                      </div>
                    </div>
                    {m.poster && (
                      <div className="relative z-10 hidden w-44 shrink-0 overflow-hidden rounded-2xl border border-white/15 shadow-2xl lg:block">
                        <CinemaImg src={toListPoster(m.poster)} loading={idx === 0 ? 'eager' : 'lazy'} className="aspect-[2/3] w-full object-cover" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* 移动端悬浮极光搜索框（桌面端已在顶栏常驻） */}
              <form
                className="aur absolute bottom-3 left-4 right-4 z-30 shadow-2xl lg:hidden"
                onSubmit={(e) => { e.preventDefault(); startSearch(query); }}
              >
                <div className="flex items-center gap-2 rounded-[18.5px] bg-[#0d0f14] px-3.5 py-2.5">
                  <span className="text-sm" style={{ color: 'var(--a)' }}>✦</span>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    aria-label="AI 搜索"
                    className="flex-1 bg-transparent text-sm text-[#f3efe6] placeholder:text-white/40 focus:outline-none"
                  />
                  <button type="submit" className="rounded-xl px-3 py-1 text-xs font-medium text-[#08090b]" style={{ background: 'var(--a)' }}>搜索</button>
                </div>
              </form>
            </section>

            {/* 情绪灵感胶囊（大号 Emoji + 时段置顶 + 换一批 + 1~2 个多选组合） */}
            <section className="mt-5 px-4 lg:mt-7 lg:px-0">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="font-serif text-base font-semibold lg:text-lg">此刻心情</h2>
                  <span className="font-mono text-[10px] text-white/45 lg:text-xs">点选 1~2 个自由组合</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMoodPage((p) => p + 1)}
                  className="glass inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] text-white/75 transition hover:bg-white/15 hover:text-white active:scale-95"
                >
                  <span>🎲</span>
                  <span>换一批</span>
                </button>
              </div>
              <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:gap-3">
                {visibleMoods.map((mood) => {
                  const picked = selectedMoods.some((m) => m.label === mood.label);
                  const isTimePick = timeSlot !== 'any' && mood.slot === timeSlot;
                  return (
                    <button
                      key={mood.label}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggleMood(mood)}
                      className={`group relative flex h-[112px] w-[124px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-2xl border p-3 text-left transition-all hover:-translate-y-0.5 active:scale-95 lg:w-auto ${
                        picked ? 'shadow-lg' : 'border-white/10'
                      }`}
                      style={{
                        background: mood.bg,
                        borderColor: picked ? 'var(--a)' : undefined,
                        boxShadow: picked ? '0 0 0 1px var(--a), 0 8px 20px -8px var(--a)' : undefined,
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <span
                          className={`text-[30px] leading-none transition-transform duration-200 group-hover:scale-110 ${
                            picked ? 'scale-110' : ''
                          }`}
                          role="img"
                          aria-hidden
                        >
                          {mood.emoji}
                        </span>
                        {picked ? (
                          <span
                            className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-[#08090b]"
                            style={{ background: 'var(--a)' }}
                          >
                            ✓
                          </span>
                        ) : mood.hot ? (
                          <span className="rounded-full bg-black/45 px-1.5 py-0.5 font-mono text-[9px] text-[#ffd27a] backdrop-blur-sm">
                            热议
                          </span>
                        ) : isTimePick ? (
                          <span className="rounded-full bg-black/45 px-1.5 py-0.5 font-mono text-[9px] text-white/85 backdrop-blur-sm">
                            此刻
                          </span>
                        ) : null}
                      </div>
                      <span>
                        <span className="block truncate text-xs font-semibold lg:text-sm">{mood.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-white/55">{mood.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 选中 1~2 个心情后浮现的组合策展栏 */}
              {selectedMoods.length > 0 && (
                <div className="glass mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/15 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono text-[10px] text-white/45">已选情绪：</span>
                    {selectedMoods.map((m, idx) => (
                      <span key={m.label} className="inline-flex items-center gap-1">
                        {idx > 0 && <span className="font-mono text-white/35">+</span>}
                        <button
                          type="button"
                          onClick={() => toggleMood(m)}
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-white/95 hover:bg-white/20"
                        >
                          <span>{m.emoji}</span>
                          <span>{m.label}</span>
                          <span className="text-white/45">×</span>
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedMoods([])}
                      className="rounded-full px-2.5 py-1 text-[11px] text-white/55 hover:text-white"
                    >
                      清空
                    </button>
                    <button
                      type="button"
                      onClick={searchCombinedMoods}
                      className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-[#08090b] active:scale-95"
                      style={{ background: 'var(--a)' }}
                    >
                      ✦ {selectedMoods.length > 1 ? 'AI 组合找片' : 'AI 找片'}
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* 影展榜单 */}
            <section className="mt-7 px-4 lg:mt-10 lg:px-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-lg font-semibold lg:text-xl">影展榜单</h2>
                <span className="font-mono text-[11px] text-white/40">点击查看 TOP 10</span>
              </div>
              <div className="no-scrollbar flex items-start gap-3 overflow-x-auto pb-2 lg:grid lg:grid-cols-3 lg:gap-4">
                {boards.map((board) => {
                  const top = board.items[0];
                  return (
                    <button
                      key={board.id}
                      type="button"
                      onClick={() => setFullBoard(board)}
                      className="group relative flex aspect-[4/5] w-[156px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-3.5 text-left transition-all duration-300 hover:-translate-y-1 hover:border-white/20 active:scale-95 lg:aspect-[16/10] lg:w-auto lg:p-4.5"
                      style={{ background: top ? `linear-gradient(145deg, ${top.a}33, ${top.b} 70%)` : '#0d0e12' }}
                    >
                      {/* 背景海报层 */}
                      {top?.poster && (
                        <div className="absolute inset-0 z-0 overflow-hidden">
                          <CinemaImg
                            src={toListPoster(top.poster)}
                            loading="lazy"
                            decoding="async"
                            draggable={false}
                            className="h-full w-full object-cover opacity-55 transition-transform duration-500 group-hover:scale-105"
                          />
                          {/* 多层渐变暗黑遮罩 */}
                          <div
                            className="absolute inset-0 bg-gradient-to-b from-[#08090b]/40 via-[#08090b]/70 to-[#08090b] transition-opacity duration-300 group-hover:opacity-90"
                          />
                          {/* 微妙主题色顶角光 */}
                          <div
                            className="pointer-events-none absolute -right-12 -top-12 h-28 w-28 rounded-full opacity-40 blur-2xl"
                            style={{ background: top.a }}
                          />
                        </div>
                      )}

                      {/* 顶部：榜单名称与 TOP 10 胶囊 */}
                      <div className="relative z-10 flex w-full items-start justify-between gap-1">
                        <div>
                          <span className="block font-serif text-sm font-bold leading-tight text-[#f3efe6] lg:text-base">
                            {board.name}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-white/60 lg:text-xs">
                            {board.sub}
                          </span>
                        </div>
                        <span className="flex items-center gap-0.5 rounded-full border border-white/15 bg-black/45 px-2 py-0.5 font-mono text-[9px] text-[#ffd27a] backdrop-blur-md">
                          TOP 10 ›
                        </span>
                      </div>

                      {/* 底部：NO.1 金色标签与第一名片名 */}
                      <div className="relative z-10 w-full pt-4">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider text-[#ffd27a]">
                          <span className="rounded bg-[#ffd27a]/20 px-1 py-0.5 text-[9px] font-bold text-[#ffd27a]">
                            NO.1
                          </span>
                          {top?.r ? <span>★ {top.r}</span> : null}
                        </div>
                        <div className="mt-1 truncate text-xs font-semibold text-[#f3efe6] drop-shadow-sm lg:text-sm">
                          {top?.t || '每日凌晨更新'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="mt-7 px-4 lg:px-0"><ContinueWatching /></div>

            {/* 为你策展：手机 3 列，平板 4 列，桌面 5~6 列 */}
            <section className="mt-8 px-4 pb-6 lg:mt-10 lg:px-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-serif text-lg font-semibold lg:text-xl">为你策展</h2>
                <span className="font-mono text-[10px] text-white/40 lg:text-xs">点击 ✦ 或长按看 30 秒决策卡</span>
              </div>
              <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5 lg:gap-4 xl:grid-cols-6">
                {feedItems.map((item, idx) => item.editorial ? (
                  <button
                    key={item.card.id}
                    type="button"
                    onClick={() => startSearch(item.card.query)}
                    className="flex aspect-[2/3] w-full flex-col justify-between rounded-2xl border border-white/15 p-3.5 text-left transition-transform hover:-translate-y-1 active:scale-95"
                    style={{ background: `linear-gradient(150deg, ${item.card.accent || 'var(--a)'}, #14161d 86%)` }}
                  >
                    <div className="inline-flex w-fit items-center rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] tracking-wider text-white/90 backdrop-blur-sm">
                      {item.card.badge}
                    </div>
                    <div>
                      <div className="line-clamp-3 font-serif text-sm font-bold leading-snug lg:text-base">{item.card.title}</div>
                      {item.card.sub && (
                        <div className="mt-1 line-clamp-1 text-[10px] text-white/75">{item.card.sub}</div>
                      )}
                      <div className="mt-2 font-mono text-[10px] text-white/80">查看热点片单 ›</div>
                    </div>
                  </button>
                ) : (
                  <div
                    key={`${item.movie.id}-${idx}`}
                    role="button"
                    tabIndex={0}
                    className="spot-card no-callout group relative w-full cursor-pointer text-left transition-transform hover:-translate-y-1 active:scale-95"
                    onClick={() => { if (!longPressed.current) void openDetail(item.movie); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void openDetail(item.movie);
                      }
                    }}
                    onPointerDown={() => {
                      longPressed.current = false;
                      if (longTimer.current) window.clearTimeout(longTimer.current);
                      longTimer.current = window.setTimeout(() => {
                        longPressed.current = true;
                        openQuick(item.movie);
                      }, 450);
                    }}
                    onPointerUp={() => { if (longTimer.current) window.clearTimeout(longTimer.current); }}
                    onPointerCancel={() => { if (longTimer.current) window.clearTimeout(longTimer.current); }}
                    onPointerLeave={() => { if (longTimer.current) window.clearTimeout(longTimer.current); }}
                    onContextMenu={(e) => { e.preventDefault(); openQuick(item.movie); }}
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10" style={{ background: `linear-gradient(160deg, ${item.movie.a}44, ${item.movie.b})` }}>
                      {item.movie.poster && (
                        <CinemaImg
                          src={toListPoster(item.movie.poster)}
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          className="pointer-events-none h-full w-full select-none object-cover"
                        />
                      )}
                      <button
                        type="button"
                        aria-label={`${item.movie.t} 30 秒决策卡`}
                        className="absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/45 text-[11px] leading-none text-[#f3efe6] backdrop-blur-md transition-transform hover:scale-110 active:scale-90"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          openQuick(item.movie);
                        }}
                      >
                        ✦
                      </button>
                      <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#ffd27a] backdrop-blur-sm">★ {item.movie.r}</span>
                    </div>
                    <div className="mt-1.5 truncate text-[11px] font-medium text-[#f3efe6]/90 lg:text-xs">{item.movie.t}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'library' && <LibraryPane onOpen={(item) => void openDetail(item)} onSearch={startSearch} />}

        {tab === 'live' && (
          <div className="flex min-h-[75vh] flex-col items-center justify-center px-6 text-center">
            <div className="relative mb-4 flex h-28 w-28 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full border border-white/10" />
              <svg className="h-16 w-16 text-white/70" fill="none" stroke="currentColor" strokeWidth="1.3" viewBox="0 0 24 24">
                <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M17 2l-5 5-5-5" />
              </svg>
            </div>
            {liveCount > 0 ? (
              <button type="button" className="rounded-full px-5 py-2.5 text-sm font-medium text-[#08090b]" style={{ background: 'var(--a)' }} onClick={() => router.push('/live')}>
                进入电视直播
              </button>
            ) : (
              <p className="text-sm tracking-wide text-white/60">直播源未配置</p>
            )}
          </div>
        )}
      </div>

      {/* AI 搜索结果浮层（手机全屏，桌面居中宽屏） */}
      {searchOpen && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-[#08090b]/95 backdrop-blur-md">
          <div className="relative mx-auto min-h-screen max-w-4xl bg-[#08090b] pb-16 lg:my-6 lg:min-h-0 lg:overflow-hidden lg:rounded-3xl lg:border lg:border-white/10">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-56 overflow-hidden">
              {searchLead && (searchLead.backdrop || searchLead.poster) ? (
                <CinemaImg
                  src={toHeroMedia(searchLead.backdrop || searchLead.poster)}
                  loading="eager"
                  decoding="async"
                  className="h-full w-full object-cover opacity-40 transition-opacity duration-700"
                />
              ) : (
                <div
                  className="h-full w-full opacity-25 transition-colors duration-700"
                  style={{ background: 'radial-gradient(120% 90% at 50% 0%, var(--a), transparent 70%)' }}
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-[#08090b]/45 via-[#08090b]/80 to-[#08090b]" />
            </div>

            <div className="relative z-10 px-4 pt-4 lg:px-8 lg:pt-6">
              <div className="mb-4 flex items-center gap-2">
                <button type="button" className="glass rounded-full px-3 py-1.5 text-xs text-white/80 hover:bg-white/15" onClick={closeSearch}>‹ 返回</button>
                <form className="aur flex-1" onSubmit={(e) => { e.preventDefault(); startSearch(query); }}>
                  <div className="flex items-center gap-2 rounded-[18.5px] bg-[#0d0f14] px-3 py-2">
                    <span className="text-xs" style={{ color: 'var(--a)' }}>✦</span>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent text-xs text-white focus:outline-none lg:text-sm" />
                    <button type="submit" className="rounded-lg px-3 py-1 text-xs font-medium text-[#08090b]" style={{ background: 'var(--a)' }}>搜索</button>
                  </div>
                </form>
              </div>

              <SearchStepper
                step={searchStep}
                filteredCount={filteredOut.length}
                expanded={stepperExpanded}
                onToggle={() => setStepperExpanded((v) => !v)}
              />

              {intro && (
                <div className="glass mb-4 rounded-2xl p-3.5 lg:p-4">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--a)' }}>AI 策展人导语</div>
                  <p className="text-xs leading-relaxed text-[#f3efe6]/90 lg:text-sm">{intro}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {results.map((item) => (
                  <button key={item.t} type="button" className="glass flex w-full gap-3 rounded-2xl p-3 text-left transition hover:bg-white/10 active:scale-[0.99]" onClick={() => void openDetail(item)}>
                    <div className="h-28 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-white/5" style={{ background: `linear-gradient(160deg, ${item.a}44, #14161d)` }}>
                      {item.poster && (
                        <CinemaImg src={item.poster} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="truncate font-serif text-base font-bold">{item.t}</h3>
                        <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]" style={{ color: 'var(--a)' }}>{item.match}%</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-white/50">{item.y || '精选'} · {item.s} 条可用线路</div>
                      <p className="mt-1.5 line-clamp-2 text-xs text-white/75">{item.w}</p>
                      <span className="mt-2 inline-block rounded-full px-3 py-1 text-[11px] font-medium text-[#08090b]" style={{ background: 'var(--a)' }}>▶ 立即播放</span>
                    </div>
                  </button>
                ))}
              </div>
              {filteredOut.length > 0 && (
                <p className="mt-4 text-center font-mono text-[11px] text-white/40">已过滤无源：{filteredOut.join('、')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 影片详情弹窗（手机全屏，桌面宽屏居中卡片） */}
      {active && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md lg:flex lg:items-center lg:justify-center lg:p-6" onClick={() => setActive(null)}>
          <div className="mx-auto min-h-screen w-full max-w-2xl overflow-hidden bg-[#08090b] pb-12 lg:min-h-0 lg:max-h-[90vh] lg:overflow-y-auto lg:rounded-3xl lg:border lg:border-white/15 lg:pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="relative flex aspect-[16/9] w-full items-end overflow-hidden bg-black p-5" style={{ background: `linear-gradient(180deg, ${'a' in active ? active.a : '#222'}55, #08090b)` }}>
              {('backdrop' in active ? active.backdrop : undefined) || active.poster ? (
                <CinemaImg
                  src={toHeroMedia(('backdrop' in active && active.backdrop) || active.poster)}
                  loading="eager"
                  decoding="async"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-45"
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090b] via-[#08090b]/45 to-transparent" />
              <button type="button" className="glass absolute left-4 top-4 z-10 rounded-full px-3 py-1 text-xs backdrop-blur-md hover:bg-white/20" onClick={() => setActive(null)}>‹ 返回</button>
              <h2 className="relative z-10 font-serif text-2xl font-bold lg:text-3xl">{active.t}</h2>
            </div>
            <div className="p-5">
              <div className="font-mono text-xs text-white/55">
                {'d' in active && active.d ? `${active.d} 上映` : active.y ? `${active.y} 年` : '精选影片'}
                {'r' in active && active.r ? <span className="ml-2 text-[#ffd27a]">★ {active.r}</span> : null}
              </div>
              <DecisionCard title={active.t} year={'y' in active ? active.y : undefined} overview={'w' in active ? active.w : ''} compact />
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">可用片源</span>
                  <span className="font-mono text-[10px] text-white/40">{hitsLoading ? '正在校验片源…' : `${hits.length} 条`}</span>
                </div>
                {!hitsLoading && hits.length === 0 && (
                  <p className="text-xs text-white/45">没有找到可播放的片源。{isAdmin ? '请在设置 → 管理员控制台中勾选点播源。' : '请联系管理员检查点播源配置。'}</p>
                )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {hits.slice(0, 8).map((hit) => (
                    <button key={`${hit.sourceKey}-${hit.vodId}`} type="button" className="glass flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs transition hover:bg-white/12" onClick={() => play(hit)}>
                      <span className="min-w-0 pr-2">
                        <span className="block truncate font-medium">{hit.name}</span>
                        <span className="text-white/45">{hit.sourceName}{hit.remarks ? ` · ${hit.remarks}` : ''}</span>
                      </span>
                      <span className="shrink-0 font-medium" style={{ color: 'var(--a)' }}>播放 ›</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 30 秒决策卡快速预览 */}
      {quick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onClick={() => setQuick(null)}>
          <div className="glass w-full max-w-[400px] rounded-3xl border border-white/15 bg-[#101218]/95 p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[10px]" style={{ color: 'var(--a)' }}>✦ 30 秒决策卡预览</span>
                <h3 className="mt-0.5 font-serif text-xl font-bold">{quick.t}</h3>
              </div>
              <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-[#ffd27a]">★ {quick.r}</span>
            </div>
            {quickLoading && <div className="py-6 text-center font-mono text-xs text-white/45">策展人正在提炼看点与劝退点...</div>}
            {quickCard && (
              <div className="space-y-2.5 text-xs leading-relaxed">
                <div><div className="font-mono text-[10px] text-white/45">核心看点</div><p className="mt-0.5">{quickCard.p}</p></div>
                <div><div className="font-mono text-[10px] text-white/45">潜在劝退点</div><p className="mt-0.5 text-white/80">{quickCard.c}</p></div>
                <div className="flex flex-wrap gap-1.5">{quickCard.f.map((tag) => <span key={tag} className="rounded-md bg-white/10 px-2 py-0.5 text-[10px]">{tag}</span>)}</div>
              </div>
            )}
            <div className="mt-4 flex gap-2 border-t border-white/10 pt-3">
              <button type="button" className="flex-1 rounded-xl py-2 text-xs font-semibold text-[#08090b]" style={{ background: 'var(--a)' }} onClick={() => { const m = quick; setQuick(null); void openDetail(m); }}>▶ 进入放映室</button>
              <button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white/70 hover:bg-white/15" onClick={() => setQuick(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* 完整榜单浮层 */}
      {fullBoard && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-black/80 backdrop-blur-md lg:flex lg:items-center lg:justify-center lg:p-6" onClick={() => setFullBoard(null)}>
          <div className="mx-auto min-h-screen w-full max-w-3xl bg-[#08090b] px-4 pb-12 pt-4 lg:min-h-0 lg:max-h-[88vh] lg:overflow-y-auto lg:rounded-3xl lg:border lg:border-white/15 lg:p-6" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-center justify-between">
              <button type="button" className="glass rounded-full px-3 py-1 text-xs" onClick={() => setFullBoard(null)}>‹ 返回</button>
              <div className="text-right">
                <h2 className="font-serif text-lg font-bold lg:text-xl">{fullBoard.name}</h2>
                <p className="font-mono text-[10px] text-white/45">{fullBoard.sub} · TOP 10</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {fullBoard.items.slice(0, 10).map((item, idx) => (
                <button key={item.id} type="button" className="glass flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition hover:bg-white/12" onClick={() => void openDetail(item)}>
                  <span className="w-6 text-center font-mono text-lg font-bold" style={{ color: idx < 3 ? 'var(--a)' : 'rgba(255,255,255,.35)' }}>{idx + 1}</span>
                  <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${item.a}, ${item.b})` }}>
                    {item.poster && (
                      <CinemaImg src={toListPoster(item.poster)} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{item.t}</span>
                    <span className="font-mono text-[10px] text-white/50">{item.d} · {item.ty}</span>
                    <span className="mt-1 block truncate text-[11px] text-white/60">{item.w}</span>
                  </span>
                  <span className="pr-1 font-mono text-xs font-bold text-[#ffd27a]">{item.r}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 新版暗黑玻璃分权设置面板（区分管理员与访客） */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm lg:items-center lg:p-6" onClick={() => setSettingsOpen(false)}>
          <div
            className="glass w-full max-w-lg rounded-t-3xl border-b-0 bg-[#101218]/95 p-5 lg:rounded-3xl lg:border-b"
            style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 lg:hidden" />
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-serif text-lg font-bold">影展设置</h3>
              <button type="button" className="text-xs text-white/50 hover:text-white" onClick={() => setSettingsOpen(false)}>关闭</button>
            </div>

            {/* 账号与角色区 */}
            <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{verified && user ? user.username : '未登录'}</span>
                  {verified && user && (
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                      style={isAdmin ? { background: 'var(--a)', color: '#08090b' } : { background: 'rgba(255,255,255,.12)', color: '#f3efe6' }}
                    >
                      {isAdmin ? '管理员' : '访客'}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-white/45">
                  {verified
                    ? isAdmin
                      ? '拥有片源维护、订阅同步与用户/邀请码管理权限'
                      : '当前为访客权限，片源由管理员统一维护'
                    : '登录后可跨设备同步观看记录与偏好设置'}
                </div>
              </div>
              {verified ? (
                <button
                  type="button"
                  className="rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white/80 hover:bg-white/20"
                  onClick={() => {
                    setSettingsOpen(false);
                    void logout();
                  }}
                >
                  退出
                </button>
              ) : (
                <button
                  type="button"
                  className="rounded-xl px-3.5 py-1.5 text-xs font-medium text-[#08090b]"
                  style={{ background: 'var(--a)' }}
                  onClick={() => {
                    setSettingsOpen(false);
                    openLogin();
                  }}
                >
                  登录
                </button>
              )}
            </div>

            {/* 通用播放偏好（访客与管理员均可见） */}
            <div className="mb-4 divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.04] px-4">
              <SettingToggle
                title="自动连播下一集"
                desc="当前集播完后自动切入下一集"
                checked={autoplayNext}
                onChange={(v) => updateSettings({ autoplayNext: v })}
              />
              <SettingToggle
                title="智能过滤切片广告"
                desc="播放 HLS 时自动跳过常见插播广告分片"
                checked={adFilter}
                onChange={(v) => updateSettings({ adFilter: v })}
              />
              <SettingToggle
                title="自动跳过已标记片头/片尾"
                desc="命中自定义跳过区间时自动跳转"
                checked={autoSkipSegments}
                onChange={(v) => updateSettings({ autoSkipSegments: v })}
              />
              <SettingToggle
                title="音量放大 (1.8×)"
                desc="提升偏小声片源响度（默认关闭）"
                checked={volumeBoost}
                onChange={(v) => updateSettings({ volumeBoost: v })}
              />
            </div>

            {/* 数据清理（访客与管理员均可见） */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-xl bg-white/10 py-2.5 text-xs text-white/85 hover:bg-white/15"
                onClick={() => {
                  void clearAllHistory();
                  toast('已清空观看记录', 'success');
                }}
              >
                清空观看记录
              </button>
              <button
                type="button"
                className="rounded-xl bg-white/10 py-2.5 text-xs text-white/85 hover:bg-white/15"
                onClick={() => {
                  try {
                    localStorage.removeItem('libretv_ai_decision_cards_v1');
                    localStorage.removeItem(FASTEST_SOURCES_KEY);
                  } catch {}
                  toast('已清理本地缓存', 'success');
                }}
              >
                清理本地缓存
              </button>
            </div>

            {/* 管理员专属入口 */}
            {isAdmin && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <div className="mb-2 font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--a)' }}>
                  管理员控制台
                </div>
                <button
                  type="button"
                  className="w-full rounded-xl py-2.5 text-xs font-semibold text-[#08090b] active:scale-[0.99]"
                  style={{ background: 'var(--a)' }}
                  onClick={() => {
                    setSettingsOpen(false);
                    setSourceOpen(true);
                  }}
                >
                  管理点播源、直播订阅与用户邀请码 ›
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <SourceManagerDrawer open={sourceOpen} onClose={() => setSourceOpen(false)} />

      {/* 移动端底部毛玻璃 Dock（桌面端隐藏） */}
      {!searchOpen && !active && !fullBoard && (
        <nav className="glass fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-x-0 border-b-0 border-t border-white/10 lg:hidden" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
          <div className="grid grid-cols-4 pt-2">
            <DockButton label="影展" active={tab === 'home'} onClick={() => setTab('home')} icon="spark" />
            <DockButton label="片库" active={tab === 'library'} onClick={() => setTab('library')} icon="grid" />
            <DockButton label="直播" active={tab === 'live'} onClick={() => setTab('live')} icon="live" />
            <DockButton label="设置" active={false} onClick={() => setSettingsOpen(true)} icon="gear" />
          </div>
        </nav>
      )}
    </div>
  );
}

function SettingToggle({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-xs">
      <div>
        <div className="font-medium text-white/90">{title}</div>
        <div className="mt-0.5 text-[10px] text-white/45">{desc}</div>
      </div>
      <button
        type="button"
        aria-pressed={checked}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? 'var(--a)' : 'rgba(255,255,255,.15)' }}
        onClick={() => onChange(!checked)}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-[#08090b] transition-all"
          style={{ left: checked ? 22 : 2 }}
        />
      </button>
    </div>
  );
}

const STEP_META = [
  { id: 'intent', label: '理解意图' },
  { id: 'mood', label: '情绪标签' },
  { id: 'match', label: '匹配片库' },
  { id: 'verify', label: '校验片源' },
] as const;

/** 极简横向时间轴步进器：4 个圆形 SVG 节点 + 脉冲动效 + 完成后自动折叠为紧凑胶囊 */
function SearchStepper({
  step,
  filteredCount,
  expanded,
  onToggle,
}: {
  step: number;
  filteredCount: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const finished = step >= 4;

  if (finished && !expanded) {
    return (
      <div className="mb-3 flex justify-center">
        <button
          type="button"
          onClick={onToggle}
          className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] text-white/80 transition-all hover:text-white active:scale-95"
        >
          <span style={{ color: 'var(--a)' }}>✦</span>
          <span>
            已完成 4 步策展
            {filteredCount > 0 ? ` · 过滤无源 ${filteredCount} 部` : ' · 片源已就绪'}
          </span>
          <span className="text-white/40">▾</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 transition-all duration-300">
      <div className="relative flex items-start justify-between">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-[14px] h-[1.5px] bg-white/10" />
        <div
          className="pointer-events-none absolute left-[12.5%] top-[14px] h-[1.5px] transition-all duration-500"
          style={{
            background: 'var(--a)',
            width: `${Math.max(0, Math.min(3, step)) * 25}%`,
          }}
        />
        {STEP_META.map((item, idx) => {
          const done = step > idx;
          const active = step === idx;
          return (
            <div key={item.id} className="relative z-10 flex w-1/4 flex-col items-center">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-300 ${
                  active ? 'step-ring-active border-transparent' : done ? 'border-transparent' : 'border-white/15 bg-[#0d0f14] text-white/35'
                }`}
                style={
                  done
                    ? { background: 'var(--a)', color: '#08090b' }
                    : active
                      ? { background: '#14161d', borderColor: 'var(--a)', color: 'var(--a)' }
                      : undefined
                }
              >
                {done ? (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <StepIcon id={item.id} />
                )}
              </div>
              <span
                className={`mt-1.5 text-center font-mono text-[10px] transition-colors ${
                  done || active ? 'text-white/90' : 'text-white/35'
                }`}
              >
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
      {finished && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2.5 block w-full text-center font-mono text-[10px] text-white/45 hover:text-white/75"
        >
          收起策展步骤 ▴
        </button>
      )}
    </div>
  );
}

function StepIcon({ id }: { id: (typeof STEP_META)[number]['id'] }) {
  if (id === 'intent') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.2 6.2L20 12l-5.8 2.8L12 21l-2.2-6.2L4 12l5.8-2.8L12 3z" />
      </svg>
    );
  }
  if (id === 'mood') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2.5" />
        <path d="M8.5 8.5a5 5 0 0 1 7 0M15.5 15.5a5 5 0 0 1-7 0" />
        <path d="M5.5 5.5a9 9 0 0 1 13 0M18.5 18.5a9 9 0 0 1-13 0" />
      </svg>
    );
  }
  if (id === 'match') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 8h4M3 16h4M17 8h4M17 16h4" />
      </svg>
    );
  }
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12h4l2.5-6 4 12 3-7 2 1h4.5" />
    </svg>
  );
}

function DockButton({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: 'spark' | 'grid' | 'live' | 'gear' }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 py-1" style={{ color: active ? 'var(--a)' : 'rgba(243,239,230,.5)' }}>
      {icon === 'spark' && <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5L12 3z" /></svg>}
      {icon === 'grid' && <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
      {icon === 'live' && <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M17 2l-5 5-5-5" /></svg>}
      {icon === 'gear' && <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></svg>}
      <span className="text-[10px]">{label}</span>
    </button>
  );
}

type FeedCell =
  | { editorial: true; card: CatalogEditorial }
  | { editorial: false; movie: CatalogItem };

function buildFallbackEditorials(hero: CatalogItem[]): CatalogEditorial[] {
  const topTitle = hero[0]?.t || '高分悬疑';
  const secondTitle = hero[1]?.t || '冷门佳片';
  return [
    {
      id: 'ed_fallback_1',
      badge: '🔥 豆瓣今日热议',
      title: `都在聊《${topTitle}》？这 3 部同气质佳作更上头`,
      sub: '顺着今日热榜挖同款氛围',
      query: `像《${topTitle}》一样口碑出圈、剧情紧凑、值得一口气刷完的高分影视`,
      accent: hero[0]?.a || '#e86f51',
    },
    {
      id: 'ed_fallback_2',
      badge: '🌙 今晚放映指南',
      title: '今晚这 3 部适合一个人关灯看，后劲极大',
      sub: '深夜沉浸与情绪疗愈',
      query: '适合深夜一个人关灯看、氛围感极强、后劲大的高分电影',
      accent: '#5ea8ff',
    },
    {
      id: 'ed_fallback_3',
      badge: '🎞️ 策展人私藏',
      title: `除了《${secondTitle}》，这 3 部 8.5+ 冷门神片别错过`,
      sub: '高分小众不踩雷',
      query: '豆瓣8.5分以上冷门小众、摄影高级、很少人推荐但极其惊艳的电影',
      accent: '#b28cff',
    },
  ];
}

function buildFeedFlat(
  boards: typeof catalog.boards,
  hero: CatalogItem[],
  dailyEditorials?: CatalogEditorial[]
): FeedCell[] {
  const seen = new Set<string>();
  const list: FeedCell[] = [];
  boards.forEach((b) => {
    b.items.forEach((m) => {
      if (!seen.has(m.t) && list.length < 21) {
        seen.add(m.t);
        list.push({ editorial: false, movie: m });
      }
    });
  });

  const editorials =
    dailyEditorials && dailyEditorials.length > 0
      ? dailyEditorials.slice(0, 3)
      : buildFallbackEditorials(hero);

  // 将 3 张每日热点 AI 策展笔记均匀穿插在瀑布流第 3、10、17 位
  const slots = [2, 9, 16];
  editorials.forEach((card, idx) => {
    const pos = slots[idx];
    if (pos !== undefined && list.length >= pos) {
      list.splice(pos, 0, { editorial: true, card });
    } else {
      list.push({ editorial: true, card });
    }
  });
  return list;
}

function LibraryPane({ onOpen, onSearch }: { onOpen: (item: CatalogItem) => void; onSearch: (q: string) => void }) {
  const [lib, setLib] = useState({ type: '全部', region: '全部', year: '全部', sort: '热度' });
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = async (reset: boolean, next = lib, nextPage = reset ? 1 : page) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ ...next, page: String(nextPage) });
      const res = await fetch(`/api/library?${qs.toString()}`);
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
        return;
      }
      const data = (await res.json()) as { total?: number; items?: CatalogItem[] };
      setTotal(data.total || 0);
      setItems((prev) => (reset ? data.items || [] : [...prev, ...(data.items || [])]));
      setPage(nextPage + 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilter = (key: keyof typeof lib, val: string) => {
    const next = { ...lib, [key]: val };
    setLib(next);
    void load(true, next, 1);
  };
  const shown = keyword.trim()
    ? items.filter((i) => i.t.toLowerCase().includes(keyword.trim().toLowerCase()))
    : items;

  const chip = (on: boolean) => on
    ? { background: 'var(--a)', color: '#08090b', fontWeight: 600 }
    : { background: 'rgba(255,255,255,.07)', color: 'rgba(243,239,230,.65)' };

  return (
    <div className="px-4 pb-6 pt-4 lg:px-0 lg:pt-6">
      <form className="glass mb-4 flex max-w-xl items-center gap-2 rounded-xl px-3.5 py-2.5" onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) onSearch(keyword); }}>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="筛选片名，回车交给 AI 策展" className="flex-1 bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none lg:text-sm" />
      </form>
      <div className="mb-5 space-y-2.5 text-xs">
        <div className="no-scrollbar flex gap-5 overflow-x-auto border-b border-white/10 pb-2.5">
          {['全部', '电影', '剧集', '动画', '综艺'].map((v) => (
            <button key={v} type="button" className={lib.type === v ? 'font-semibold text-white' : 'text-white/50 hover:text-white'} onClick={() => setFilter('type', v)}>{v}</button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {['全部', '大陆', '港台', '欧美', '日韩'].map((v) => (
            <button key={v} type="button" className="rounded-full px-3 py-1" style={chip(lib.region === v)} onClick={() => setFilter('region', v)}>{v}</button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {['全部', '2026', '2025', '2024', '更早'].map((v) => (
            <button key={v} type="button" className="rounded-full px-3 py-1 font-mono" style={chip(lib.year === v)} onClick={() => setFilter('year', v)}>{v}</button>
          ))}
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-2">
            {['热度', '评分', '最新'].map((v) => (
              <button key={v} type="button" className={`rounded-lg px-2.5 py-1 text-[11px] ${lib.sort === v ? 'border border-white/40 bg-white/10 text-white' : 'text-white/45 hover:text-white'}`} onClick={() => setFilter('sort', v)}>按{v}</button>
            ))}
          </div>
          <span className="font-mono text-[10px] text-white/40 lg:text-xs">共 {total} 部 · 按{lib.sort}排序</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 lg:gap-4">
        {shown.map((item) => (
          <button key={`${item.id}-${item.t}`} type="button" className="group text-left transition-transform hover:-translate-y-1 active:scale-95" onClick={() => onOpen(item)}>
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10" style={{ background: `linear-gradient(160deg, ${item.a}, ${item.b})` }}>
              {item.poster && (
                <CinemaImg src={toListPoster(item.poster)} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              )}
              {item.d && <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px]">{item.d}</span>}
              {item.r > 0 && <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#ffd27a]">★ {item.r}</span>}
            </div>
            <div className="mt-1.5 truncate text-[11px] font-medium lg:text-xs">{item.t}</div>
          </button>
        ))}
      </div>
      <div className="mt-6 text-center">
        {!loading && shown.length === 0 && <p className="py-8 text-xs text-white/40">当前筛选条件下暂无影片</p>}
        {items.length > 0 && !loading && (
          <button type="button" className="glass rounded-full px-5 py-2 text-xs text-white/75 hover:bg-white/15" onClick={() => void load(false)}>加载更多</button>
        )}
        {loading && <span className="font-mono text-xs text-white/40">片库加载中...</span>}
      </div>
    </div>
  );
}

function useSelectedSources(): SourceConfig[] {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);
  return useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is SourceConfig => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);
}

function pickMatchedHits(title: string, list: SearchResultItem[]): SearchResultItem[] {
  const matched = list.filter((item) => item.name?.includes(title) || title.includes(item.name || ''));
  return (matched.length ? matched : list).slice(0, 8);
}

/**
 * 并发查源（单源 3 秒 AbortController 超时断路 + 渐进回调 + 最快源记忆）：
 * 不再等最慢或失效的源站超时才整体出图，每回来一条有效源即刻更新 UI。
 */
async function searchTitleFast(
  title: string,
  sources: SourceConfig[],
  yellowFilter: boolean,
  opts?: { onProgress?: (hits: SearchResultItem[]) => void; isStale?: () => boolean }
): Promise<SearchResultItem[]> {
  if (!sources.length) return [];
  const ordered = sortSourcesBySpeed(sources);
  const aggregated: SearchResultItem[] = [];
  const seen = new Set<string>();

  await Promise.allSettled(
    ordered.map(async (source) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
      const started = performance.now();
      try {
        const res = await api.search(title, [source], yellowFilter, { signal: controller.signal });
        if (opts?.isStale?.()) return;
        const list = res.list || [];
        if (list.length > 0) {
          recordSourceSpeed(source.key, performance.now() - started);
          let changed = false;
          for (const item of list) {
            const key = `${item.sourceKey}:${item.vodId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            aggregated.push(item);
            changed = true;
          }
          if (changed) {
            opts?.onProgress?.(pickMatchedHits(title, aggregated));
          }
        }
      } catch {
        /* 3s 超时或单源异常直接断路跳过 */
      } finally {
        window.clearTimeout(timer);
      }
    })
  );

  return pickMatchedHits(title, aggregated);
}

async function runCurate(
  q: string,
  sources: SourceConfig[],
  yellowFilter: boolean,
  hooks: {
    isStale: () => boolean;
    onStep: (n: number) => void;
    onIntro: (text: string) => void;
    onUpsertResult: (item: HitItem) => void;
    onDone: (missing: string[]) => void;
  }
) {
  const res = await fetch(`/api/ai/curate?q=${encodeURIComponent(q)}`);
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
    return;
  }
  if (!res.ok || !res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let movies: Pick[] = [];
  const consume = (block: string) => {
    const event = /event: (\w+)/.exec(block)?.[1];
    const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
    if (!event || !dataLine) return;
    const data = JSON.parse(dataLine.slice(6)) as { index?: number; text?: string; movies?: Pick[] };
    if (hooks.isStale()) return;
    if (event === 'step' && typeof data.index === 'number') hooks.onStep(data.index);
    if (event === 'intro' && data.text) hooks.onIntro(data.text);
    if (event === 'movies' && data.movies) movies = data.movies;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    parts.forEach(consume);
  }
  if (buffer.trim()) consume(buffer);
  if (hooks.isStale()) return;

  hooks.onStep(3);
  const missing: string[] = [];

  await Promise.all(
    movies.map(async (movie, index) => {
      const match = Math.max(80, 97 - index * 3);
      const pushHit = (found: SearchResultItem[]) => {
        if (!found.length || hooks.isStale()) return;
        const media = resolveSafeMedia(movie.t, found.find((h) => h.pic)?.pic);
        hooks.onUpsertResult({
          ...movie,
          s: found.length,
          match,
          poster: media.poster,
          backdrop: media.backdrop,
          a: media.a,
          hits: found,
        });
      };

      const finalHits = await searchTitleFast(movie.t, sources, yellowFilter, {
        isStale: hooks.isStale,
        onProgress: pushHit,
      });
      if (hooks.isStale()) return;
      if (finalHits.length > 0) {
        pushHit(finalHits);
      } else {
        missing.push(movie.t);
      }
    })
  );

  if (!hooks.isStale()) {
    hooks.onDone(missing);
  }
}
