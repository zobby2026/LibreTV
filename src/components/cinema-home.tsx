'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client-api';
import { catalog, type CatalogItem } from '@/lib/catalog';
import { clearAllHistory } from '@/lib/db';
import { isInDisabledSubscription, isSourceDisabled, resolveSource, useAppStore } from '@/lib/store';
import { buildWatchUrl, validateSourceUrl } from '@/lib/utils';
import { ContinueWatching } from './continue-watching';
import { DecisionCard, type DecisionCardData } from './decision-card';
import { SourceManagerDrawer } from './source-manager';
import { toggleFilmFx, FX_EVENT } from './film-fx';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

const MOODS = [
  { label: '深夜 emo', sub: '孤独与治愈', icon: '☾', bg: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  { label: '适合下饭', sub: '轻快不费脑', icon: '☀', bg: 'linear-gradient(135deg,#451a03,#1c1917)' },
  { label: '烧脑反转', sub: '高能悬疑', icon: '❖', bg: 'linear-gradient(135deg,#312e81,#0f172a)' },
  { label: '周末轻松喜剧', sub: '放松大笑', icon: '✦', bg: 'linear-gradient(135deg,#064e3b,#022c22)' },
  { label: '高分冷门', sub: '私藏佳片', icon: '◈', bg: 'linear-gradient(135deg,#4c1d95,#1e1b4b)' },
];

const PLACEHOLDERS = [
  '想看一部看完不想说话的片',
  '适合周末晚上边吃外卖边看的轻喜剧',
  '像《黑镜》一样细思极恐的反转剧',
  '雨夜、爵士乐与孤独灵魂的文艺片',
];

interface Pick { t: string; y: number; w: string }
interface HitItem extends Pick {
  s: number;
  match: number;
  poster: string;
  hits: SearchResultItem[];
}

/** 移动端 AI 影展。片源不在服务端扇出，拿到片名后走现有 /api/search。 */
export function CinemaHome({ initialTab = 'home' }: { initialTab?: 'home' | 'library' }) {
  const router = useRouter();
  const hero = catalog.hero || [];
  const boards = catalog.boards || [];
  const [tab, setTab] = useState<'home' | 'library' | 'live'>(initialTab);
  const [heroIdx, setHeroIdx] = useState(0);
  const [openBoard, setOpenBoard] = useState<string | null>(null);
  const [fullBoard, setFullBoard] = useState<(typeof boards)[number] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [fxOn, setFxOn] = useState(true);
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
  const [intro, setIntro] = useState('');
  const [results, setResults] = useState<HitItem[]>([]);
  const [filteredOut, setFilteredOut] = useState<string[]>([]);

  const [active, setActive] = useState<CatalogItem | HitItem | null>(null);
  const [hits, setHits] = useState<SearchResultItem[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);

  const selectedSources = useSelectedSources();
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const liveCount = useAppStore((s) => s.liveEnvSources.length + s.liveSubscriptions.length);

  useEffect(() => {
    const first = hero[0]?.a;
    if (first) document.documentElement.style.setProperty('--a', first);
  }, [hero]);

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

  useEffect(() => {
    const read = () => setFxOn(localStorage.getItem('libretv_fx') !== '0');
    read();
    window.addEventListener(FX_EVENT, read);
    return () => window.removeEventListener(FX_EVENT, read);
  }, []);

  const feed = useMemo(() => buildFeed(boards), [boards]);

  const onHeroScroll = () => {
    const rail = railRef.current;
    if (!rail) return;
    const i = Math.round(rail.scrollLeft / Math.max(rail.clientWidth, 1));
    if (i !== heroIdx && hero[i]) {
      setHeroIdx(i);
      document.documentElement.style.setProperty('--a', hero[i].a);
    }
  };

  const startSearch = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setQuery(text);
    setSearchOpen(true);
    setSearchStep(0);
    setIntro('');
    setResults([]);
    setFilteredOut([]);
    void runCurate(text, selectedSources, yellowFilter, {
      onStep: setSearchStep,
      onIntro: setIntro,
      onResults: (items, missing) => {
        setResults(items);
        setFilteredOut(missing);
        setSearchStep(4);
      },
    });
  };

  const openQuick = (movie: CatalogItem) => {
    setQuick(movie);
    setQuickCard(null);
    setQuickLoading(true);
    fetch('/api/ai/decision-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: movie.t, year: movie.y, overview: movie.w || '' }),
    })
      .then(async (res) => (res.ok ? (await res.json()) as DecisionCardData : null))
      .then((data) => { if (data?.p) setQuickCard(data); })
      .finally(() => setQuickLoading(false));
  };

  const openDetail = async (movie: CatalogItem | HitItem) => {
    setActive(movie);
    setHits('hits' in movie ? movie.hits : []);
    if ('hits' in movie && movie.hits.length) return;
    setHitsLoading(true);
    try {
      const found = await searchTitle(movie.t, selectedSources, yellowFilter);
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

  const accent = hero[heroIdx]?.a || '#e86f51';

  return (
    <div className="cinema-app relative mx-auto min-h-screen max-w-[480px] pb-24 text-[#f3efe6]">
      <div id="glow" style={{ backgroundColor: accent }} />

      {tab === 'home' && (
        <div>
          <section className="relative w-full overflow-hidden" style={{ height: 'calc(100svh - 70px)', minHeight: 520 }}>
            <div className="absolute left-3 right-3 top-3 z-30 flex gap-1">
              {hero.map((m, idx) => (
                <div key={m.id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full transition-[width] duration-300" style={{ width: idx <= heroIdx ? '100%' : '0%', background: 'var(--a)' }} />
                </div>
              ))}
            </div>
            <div
              ref={railRef}
              onScroll={onHeroScroll}
              className="no-scrollbar flex h-full w-full snap-x snap-mandatory overflow-x-auto"
            >
              {hero.map((m, idx) => (
                <div
                  key={m.id}
                  className="relative flex h-full w-full flex-shrink-0 snap-center flex-col justify-end px-5 pb-24"
                  style={{ background: `linear-gradient(180deg, ${m.a}33 0%, ${m.b} 100%)` }}
                >
                  {(m.backdrop || m.poster) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.backdrop || m.poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#08090b] via-[#08090b]/45 to-transparent" />
                  <div className="relative z-10">
                    <div className="rank-stroke -mb-6 select-none font-mono">{idx + 1}</div>
                    <div className="mb-1.5 flex items-center gap-2 font-mono text-xs">
                      <span className="rounded border border-white/10 bg-black/50 px-2 py-0.5 text-[#ffd27a]">★ {m.r}</span>
                      <span className="text-white/60">{m.d} · {m.ty}</span>
                    </div>
                    <h1 className="mb-2 font-serif text-[34px] font-bold leading-tight tracking-tight">{m.t}</h1>
                    <p className="mb-4 line-clamp-2 font-mono text-xs leading-relaxed text-[#f3efe6]/80">AI ▸ {m.ai || m.w}</p>
                    <button type="button" onClick={() => void openDetail(m)} className="rounded-full px-4 py-2 text-xs font-medium text-[#08090b] active:scale-95" style={{ background: 'var(--a)' }}>
                      ▶ 找片源
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="aur absolute bottom-3 left-4 right-4 z-30 shadow-2xl"
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

          <section className="mt-5 px-4">
            <div className="no-scrollbar flex gap-2.5 overflow-x-auto pb-1">
              {MOODS.map((mood) => (
                <button
                  key={mood.label}
                  type="button"
                  onClick={() => startSearch(mood.label)}
                  className="relative flex h-[104px] w-[120px] flex-shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 p-3 text-left active:scale-95"
                  style={{ background: mood.bg }}
                >
                  <span className="text-lg opacity-90">{mood.icon}</span>
                  <span>
                    <span className="block text-xs font-semibold">{mood.label}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-white/50">{mood.sub}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-7 px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold">影展榜单</h2>
              <span className="font-mono text-[11px] text-white/40">点击展开 TOP 5</span>
            </div>
            <div className="no-scrollbar flex items-start gap-3 overflow-x-auto pb-2">
              {boards.map((board) => {
                const open = openBoard === board.id;
                const top = board.items[0];
                return (
                  <div key={board.id} className="glass flex-shrink-0 overflow-hidden rounded-2xl transition-[width] duration-300" style={{ width: open ? 272 : 140 }}>
                    <button type="button" className="flex w-full items-center justify-between p-3 text-left" onClick={() => setOpenBoard(open ? null : board.id)}>
                      <span>
                        <span className="block text-sm font-semibold leading-tight">{board.name}</span>
                        <span className="mt-0.5 block text-[10px] text-white/50">{board.sub}</span>
                      </span>
                      <span className="text-xs text-white/40">{open ? '−' : '+'}</span>
                    </button>
                    {!open && (
                      <button
                        type="button"
                        className="w-full p-3 pt-6 text-left"
                        style={{ background: top ? `linear-gradient(135deg, ${top.a}55, ${top.b})` : 'rgba(255,255,255,0.03)' }}
                        onClick={() => setOpenBoard(board.id)}
                      >
                        <div className="font-mono text-[10px] tracking-widest opacity-70">NO.1</div>
                        <div className="mt-0.5 truncate text-xs font-medium">{top?.t || '每日凌晨更新'}</div>
                      </button>
                    )}
                    {open && (
                      <div className="space-y-2 border-t border-white/10 px-3 pb-3 pt-2.5">
                        {board.items.slice(0, 5).map((item, i) => (
                          <button key={`${item.id}-${i}`} type="button" className="flex w-full items-center gap-2.5 py-1 text-left" onClick={() => void openDetail(item)}>
                            <span className="w-4 text-center font-mono text-xs font-bold" style={{ color: i < 3 ? 'var(--a)' : 'rgba(255,255,255,.4)' }}>{i + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{item.t}</span>
                              <span className="font-mono text-[10px] text-white/45">{item.d} · {item.ty}</span>
                            </span>
                            <span className="font-mono text-[11px] text-[#ffd27a]">{item.r}</span>
                          </button>
                        ))}
                        <button type="button" className="mt-1 w-full border-t border-white/10 pt-2 text-center font-mono text-[11px] text-white/60" onClick={() => setFullBoard(board)}>
                          查看完整榜单 ›
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mt-7 px-4"><ContinueWatching /></div>

          <section className="mt-8 px-4 pb-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-serif text-lg font-semibold">为你策展</h2>
              <span className="font-mono text-[10px] text-white/40">长按预览决策卡</span>
            </div>
            <div className="grid grid-cols-3 items-start gap-2.5">
              {feed.map((col, cIdx) => (
                <div key={cIdx} className="space-y-2.5" style={{ marginTop: cIdx === 1 ? 34 : cIdx === 2 ? 14 : 0 }}>
                  {col.map((item, iIdx) => item.editorial ? (
                    <button key={item.id} type="button" onClick={() => startSearch(item.query)} className="w-full rounded-2xl border border-white/15 p-3 text-left active:scale-95" style={{ background: 'linear-gradient(150deg, var(--a), #14161d 85%)' }}>
                      <div className="mb-1.5 font-mono text-[9px] tracking-widest text-white/80">AI 策展笔记</div>
                      <div className="font-serif text-sm font-bold leading-snug">{item.title}</div>
                      <div className="mt-2 font-mono text-[10px] text-white/65">点击查看片单 ›</div>
                    </button>
                  ) : (
                    <button
                      key={`${item.movie.id}-${iIdx}`}
                      type="button"
                      className="spot-card w-full text-left active:scale-95"
                      onClick={() => { if (!longPressed.current) void openDetail(item.movie); }}
                      onPointerDown={() => {
                        longPressed.current = false;
                        if (longTimer.current) window.clearTimeout(longTimer.current);
                        longTimer.current = window.setTimeout(() => {
                          longPressed.current = true;
                          openQuick(item.movie);
                        }, 450);
                      }}
                      onPointerUp={() => { if (longTimer.current) window.clearTimeout(longTimer.current); }}
                      onPointerLeave={() => { if (longTimer.current) window.clearTimeout(longTimer.current); }}
                      onContextMenu={(e) => { e.preventDefault(); openQuick(item.movie); }}
                    >
                      <div className={`relative w-full overflow-hidden rounded-xl border border-white/10 ${(cIdx + iIdx) % 2 === 0 ? 'aspect-[2/3]' : 'aspect-[3/4]'}`} style={{ background: `linear-gradient(160deg, ${item.movie.a}44, ${item.movie.b})` }}>
                        {item.movie.poster && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.movie.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                        )}
                        <span className="absolute bottom-1.5 left-1.5 font-mono text-[10px] font-bold text-[#ffd27a]">★ {item.movie.r}</span>
                      </div>
                      <div className="mt-1.5 truncate text-[11px] font-medium text-[#f3efe6]/90">{item.movie.t}</div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === 'library' && <LibraryPane onOpen={(item) => void openDetail(item)} onSearch={startSearch} />}

      {tab === 'live' && (
        <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
          <div className="relative mb-4 flex h-28 w-28 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full border border-white/10" />
            <svg className="h-16 w-16 text-white/70" fill="none" stroke="currentColor" strokeWidth="1.3" viewBox="0 0 24 24">
              <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M17 2l-5 5-5-5" />
            </svg>
          </div>
          {liveCount > 0 ? (
            <button type="button" className="rounded-full px-4 py-2 text-sm text-[#08090b]" style={{ background: 'var(--a)' }} onClick={() => router.push('/live')}>
              进入直播
            </button>
          ) : (
            <p className="text-sm tracking-wide text-white/60">直播源未配置</p>
          )}
        </div>
      )}

      {searchOpen && (
        <div className="fixed inset-0 z-40 mx-auto max-w-[480px] overflow-y-auto bg-[#08090b]/95 px-4 pb-16 pt-4">
          <div className="mb-4 flex items-center gap-2">
            <button type="button" className="p-2 text-sm text-white/70" onClick={() => setSearchOpen(false)}>‹ 返回</button>
            <form className="aur flex-1" onSubmit={(e) => { e.preventDefault(); startSearch(query); }}>
              <div className="flex items-center gap-2 rounded-[18.5px] bg-[#0d0f14] px-3 py-2">
                <span className="text-xs" style={{ color: 'var(--a)' }}>✦</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 bg-transparent text-xs text-white focus:outline-none" />
                <button type="submit" className="rounded-lg px-2.5 py-1 text-xs font-medium text-[#08090b]" style={{ background: 'var(--a)' }}>搜索</button>
              </div>
            </form>
          </div>
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {['理解意图', '情绪标签', '匹配片库', '校验片源'].map((label, idx) => (
              <div key={label} className={`rounded-lg border py-1.5 text-center font-mono text-[10px] ${searchStep >= idx ? 'border-white/30 bg-white/10 text-white' : 'border-white/5 text-white/30'}`}>
                {searchStep > idx ? '✓ ' : ''}{label}
              </div>
            ))}
          </div>
          {intro && (
            <div className="glass mb-4 rounded-2xl p-3.5">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-[#e86f51]">AI 策展人导语</div>
              <p className="text-xs leading-relaxed text-[#f3efe6]/90">{intro}</p>
            </div>
          )}
          <div className="space-y-3">
            {results.map((item) => (
              <button key={item.t} type="button" className="glass flex w-full gap-3 rounded-2xl p-3 text-left" onClick={() => void openDetail(item)}>
                <div className="h-28 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-white/5">
                  {item.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.poster} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate font-serif text-base font-bold">{item.t}</h3>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-[#e86f51]">{item.match}%</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-white/50">{item.y} · {item.s} 条可用线路</div>
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
      )}

      {active && (
        <div className="fixed inset-0 z-50 mx-auto max-w-[480px] overflow-y-auto bg-[#08090b] pb-12">
          <div className="relative flex aspect-[16/10] w-full items-end bg-black p-4" style={{ background: `linear-gradient(180deg, ${'a' in active ? active.a : '#222'}55, #08090b)` }}>
            <button type="button" className="absolute left-3 top-3 rounded-full bg-white/10 px-3 py-1 text-xs" onClick={() => setActive(null)}>‹ 返回</button>
            <h2 className="font-serif text-2xl font-bold">{active.t}</h2>
          </div>
          <div className="p-4">
            <div className="font-mono text-xs text-white/55">
              {'d' in active ? active.d : active.y} 上映
              {'r' in active && active.r ? <span className="ml-2 text-[#ffd27a]">★ {active.r}</span> : null}
            </div>
            <DecisionCard title={active.t} year={'y' in active ? active.y : undefined} overview={'w' in active ? active.w : ''} compact />
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-white/80">可用片源</span>
                <span className="font-mono text-[10px] text-white/40">{hitsLoading ? '正在校验片源…' : `${hits.length} 条`}</span>
              </div>
              {!hitsLoading && hits.length === 0 && (
                <p className="text-xs text-white/45">没有找到可播放的片源。请先在设置里勾选点播源。</p>
              )}
              <div className="space-y-2">
                {hits.slice(0, 8).map((hit) => (
                  <button key={`${hit.sourceKey}-${hit.vodId}`} type="button" className="glass flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs" onClick={() => play(hit)}>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{hit.name}</span>
                      <span className="text-white/45">{hit.sourceName}{hit.remarks ? ` · ${hit.remarks}` : ''}</span>
                    </span>
                    <span className="text-[#e86f51]">播放</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {quick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5" onClick={() => setQuick(null)}>
          <div className="glass w-full max-w-[380px] rounded-3xl border border-white/15 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[10px] text-[#e86f51]">✦ 30 秒决策卡预览</span>
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
              <button type="button" className="rounded-xl bg-white/10 px-4 py-2 text-xs text-white/70" onClick={() => setQuick(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {fullBoard && (
        <div className="fixed inset-0 z-40 mx-auto max-w-[480px] overflow-y-auto bg-[#08090b] px-4 pb-12 pt-4">
          <div className="mb-5 flex items-center justify-between">
            <button type="button" className="rounded-full bg-white/10 px-3 py-1 text-xs" onClick={() => setFullBoard(null)}>‹ 返回</button>
            <div className="text-right">
              <h2 className="font-serif text-lg font-bold">{fullBoard.name}</h2>
              <p className="font-mono text-[10px] text-white/45">{fullBoard.sub} · TOP 10</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {fullBoard.items.slice(0, 10).map((item, idx) => (
              <button key={item.id} type="button" className="glass flex w-full items-center gap-3 rounded-2xl p-2.5 text-left" onClick={() => void openDetail(item)}>
                <span className="w-6 text-center font-mono text-lg font-bold" style={{ color: idx < 3 ? 'var(--a)' : 'rgba(255,255,255,.35)' }}>{idx + 1}</span>
                <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg" style={{ background: `linear-gradient(160deg, ${item.a}, ${item.b})` }}>
                  {item.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.poster} alt="" className="h-full w-full object-cover" />
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
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65" onClick={() => setSettingsOpen(false)}>
          <div className="glass w-full max-w-[480px] rounded-t-3xl border-b-0 p-5" style={{ paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="mb-4 font-serif text-lg font-bold">影展设置</h3>
            <div className="flex items-center justify-between border-b border-white/10 py-2 text-xs">
              <div>
                <div className="font-medium">胶片噪点与放映机微尘</div>
                <div className="mt-0.5 text-[10px] text-white/45">老旧机型关闭后可进一步降低功耗</div>
              </div>
              <button type="button" aria-pressed={fxOn} className="relative h-6 w-11 rounded-full" style={{ background: fxOn ? 'var(--a)' : 'rgba(255,255,255,.15)' }} onClick={() => setFxOn(toggleFilmFx())}>
                <span className="absolute top-0.5 h-5 w-5 rounded-full bg-[#08090b]" style={{ left: fxOn ? 22 : 2 }} />
              </button>
            </div>
            <button type="button" className="mt-3 w-full rounded-xl bg-white/10 py-2 text-xs" onClick={() => { setSettingsOpen(false); void clearAllHistory(); }}>
              清空观看记录
            </button>
            <button type="button" className="mt-2 w-full rounded-xl py-2 text-xs font-medium text-[#08090b]" style={{ background: 'var(--a)' }} onClick={() => { setSettingsOpen(false); setSourceOpen(true); }}>
              片源与账号设置
            </button>
          </div>
        </div>
      )}
      <SourceManagerDrawer open={sourceOpen} onClose={() => setSourceOpen(false)} />

      {!searchOpen && !active && !fullBoard && (
        <nav className="glass fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-x-0 border-b-0 border-t border-white/10" style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))' }}>
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
  | { editorial: true; id: string; title: string; query: string }
  | { editorial: false; movie: CatalogItem };

function buildFeed(boards: typeof catalog.boards): FeedCell[][] {
  const seen = new Set<string>();
  const list: FeedCell[] = [];
  boards.forEach((b) => {
    b.items.forEach((m) => {
      if (!seen.has(m.t) && list.length < 18) {
        seen.add(m.t);
        list.push({ editorial: false, movie: m });
      }
    });
  });
  if (list.length >= 4) {
    list.splice(4, 0, { editorial: true, id: 'ai_editorial_1', title: '今晚这 3 部适合一个人关灯看', query: '适合深夜一个人关灯看、氛围感极强的电影' });
  }
  const cols: FeedCell[][] = [[], [], []];
  list.forEach((item, idx) => cols[idx % 3].push(item));
  return cols;
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
    <div className="px-4 pb-6 pt-3">
      <form className="glass mb-3 flex items-center gap-2 rounded-xl px-3 py-2" onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) onSearch(keyword); }}>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="筛选片名，回车交给 AI 策展" className="flex-1 bg-transparent text-xs text-white placeholder:text-white/40 focus:outline-none" />
      </form>
      <div className="mb-4 space-y-2.5 text-xs">
        <div className="no-scrollbar flex gap-4 overflow-x-auto border-b border-white/10 pb-2">
          {['全部', '电影', '剧集', '动画', '综艺'].map((v) => (
            <button key={v} type="button" className={lib.type === v ? 'font-semibold text-white' : 'text-white/50'} onClick={() => setFilter('type', v)}>{v}</button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {['全部', '大陆', '港台', '欧美', '日韩'].map((v) => (
            <button key={v} type="button" className="rounded-full px-2.5 py-1" style={chip(lib.region === v)} onClick={() => setFilter('region', v)}>{v}</button>
          ))}
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {['全部', '2026', '2025', '2024', '更早'].map((v) => (
            <button key={v} type="button" className="rounded-full px-2.5 py-1 font-mono" style={chip(lib.year === v)} onClick={() => setFilter('year', v)}>{v}</button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {['热度', '评分', '最新'].map((v) => (
              <button key={v} type="button" className={`rounded-lg px-2.5 py-1 text-[11px] ${lib.sort === v ? 'border border-white/40 bg-white/10 text-white' : 'text-white/45'}`} onClick={() => setFilter('sort', v)}>按{v}</button>
            ))}
          </div>
          <span className="font-mono text-[10px] text-white/40">共 {total} 部 · 按{lib.sort}排序</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {shown.map((item) => (
          <button key={`${item.id}-${item.t}`} type="button" className="text-left" onClick={() => onOpen(item)}>
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-white/10" style={{ background: `linear-gradient(160deg, ${item.a}, ${item.b})` }}>
              {item.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
              {item.d && <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px]">{item.d}</span>}
              <span className="absolute bottom-1.5 left-1.5 font-mono text-[10px] font-bold text-[#ffd27a]">★ {item.r}</span>
            </div>
            <div className="mt-1.5 truncate text-[11px] font-medium">{item.t}</div>
          </button>
        ))}
      </div>
      <div className="mt-6 text-center">
        {!loading && shown.length === 0 && <p className="py-8 text-xs text-white/40">当前筛选条件下暂无影片</p>}
        {items.length > 0 && !loading && (
          <button type="button" className="glass rounded-full px-5 py-2 text-xs text-white/75" onClick={() => void load(false)}>加载更多</button>
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

async function searchTitle(title: string, sources: SourceConfig[], yellowFilter: boolean): Promise<SearchResultItem[]> {
  if (!sources.length) return [];
  try {
    const res = await api.search(title, sources, yellowFilter);
    const list = res.list || [];
    const matched = list.filter((item) => item.name?.includes(title) || title.includes(item.name || ''));
    return (matched.length ? matched : list).slice(0, 8);
  } catch {
    return [];
  }
}

async function runCurate(
  q: string,
  sources: SourceConfig[],
  yellowFilter: boolean,
  hooks: {
    onStep: (n: number) => void;
    onIntro: (text: string) => void;
    onResults: (items: HitItem[], missing: string[]) => void;
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
  hooks.onStep(3);
  const settled = await Promise.all(movies.map(async (movie, index) => {
    const found = await searchTitle(movie.t, sources, yellowFilter);
    if (!found.length) return { ok: false as const, title: movie.t };
    return {
      ok: true as const,
      item: {
        ...movie,
        s: found.length,
        match: Math.max(80, 97 - index * 3),
        poster: found.find((h) => h.pic)?.pic || '',
        hits: found,
      },
    };
  }));
  hooks.onResults(
    settled.filter((row) => row.ok).map((row) => row.item),
    settled.filter((row) => !row.ok).map((row) => row.title)
  );
}
