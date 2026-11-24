'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScreeningTimes,
  type CurateMeta,
  type CuratePick,
  type CuratorNotes,
} from '@/lib/curate-presets';
import {
  fetchDecisionCardCached,
  getCachedDecisionCard,
  type DecisionCardData,
} from '@/lib/decision-card-cache';
import type { SearchResultItem } from '@/lib/types';
import { CinemaImg } from './cinema-img';

export interface FestivalMovieItem extends CuratePick {
  s: number;
  match: number;
  poster: string;
  backdrop?: string;
  a: string;
  hits: SearchResultItem[];
}

interface FestivalResultProps {
  query: string;
  edition: number;
  meta: CurateMeta;
  notes: CuratorNotes;
  openingLine: string;
  withdrawLine: string;
  results: FestivalMovieItem[];
  filteredOut: string[];
  verifying: boolean;
  onActiveColorChange: (color: string) => void;
  onPlayNow: (item: FestivalMovieItem) => void;
  onOpenDetail: (item: FestivalMovieItem) => void;
  onResetFestival: () => void;
  onToast: (msg: string) => void;
}

const FAV_KEY = 'libretv_festival_favorites_v1';

function readFavorites(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(FAV_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavorites(list: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 80)));
  } catch {
    /* 静默跳过 */
  }
}

/**
 * 影展结果页：
 * 1. 开幕海报头（胶片孔边框 + 主题色渐变 + 第 N 届私人影展）
 * 2. 展厅走廊（3D 横向吸附画廊 + 博物馆展签 + 点击翻面看策展手记与决策卡 + 滑动切主题色）
 * 3. 今夜场次表（锯齿边 + 条码票根，点击直接播放，左滑收藏）
 * 4. 策展人手记（三段式分段打字机）
 * 5. 撤展名单（划掉的票根）与闭幕（「再办一场」）
 */
export function FestivalResult({
  query,
  edition,
  meta,
  notes,
  openingLine,
  withdrawLine,
  results,
  filteredOut,
  verifying,
  onActiveColorChange,
  onPlayNow,
  onOpenDetail,
  onResetFestival,
  onToast,
}: FestivalResultProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [flippedMap, setFlippedMap] = useState<Record<string, boolean>>({});
  const [cardsMap, setCardsMap] = useState<Record<string, DecisionCardData | null>>({});
  const [loadingCard, setLoadingCard] = useState<Record<string, boolean>>({});
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites());
  const galleryRef = useRef<HTMLDivElement | null>(null);

  const safeIdx = Math.min(activeIdx, Math.max(0, results.length - 1));
  const currentMovie = results[safeIdx];

  // 滑动海报时，页面主题色跟着当前海报变化
  useEffect(() => {
    if (currentMovie?.a) {
      onActiveColorChange(currentMovie.a);
    } else if (meta.themeColor) {
      onActiveColorChange(meta.themeColor);
    }
  }, [currentMovie?.a, meta.themeColor, onActiveColorChange]);

  const screeningTimes = useMemo(
    () => buildScreeningTimes(Math.max(1, results.length)),
    [results.length]
  );

  const toggleFavorite = (title: string) => {
    setFavorites((prev) => {
      const exists = prev.includes(title);
      const next = exists ? prev.filter((t) => t !== title) : [title, ...prev];
      saveFavorites(next);
      onToast(exists ? `已从影展收藏移除《${title}》` : `已收藏《${title}》到今夜片单`);
      return next;
    });
  };

  const toggleFlip = (item: FestivalMovieItem) => {
    const willFlip = !flippedMap[item.t];
    setFlippedMap((prev) => ({ ...prev, [item.t]: willFlip }));
    if (!willFlip) return;

    const cached = getCachedDecisionCard(item.t, item.y);
    if (cached) {
      setCardsMap((prev) => ({ ...prev, [item.t]: cached }));
      return;
    }
    if (loadingCard[item.t]) return;
    setLoadingCard((prev) => ({ ...prev, [item.t]: true }));
    void fetchDecisionCardCached({ title: item.t, year: item.y, overview: item.w })
      .then((data) => {
        if (data?.p) {
          setCardsMap((prev) => ({ ...prev, [item.t]: data }));
        }
      })
      .finally(() => {
        setLoadingCard((prev) => ({ ...prev, [item.t]: false }));
      });
  };

  const handleGalleryScroll = () => {
    const el = galleryRef.current;
    if (!el || results.length === 0) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let minDist = Number.MAX_VALUE;
    const children = el.querySelectorAll<HTMLElement>('[data-corridor-card]');
    children.forEach((child, idx) => {
      const childCenter = child.offsetLeft + child.offsetWidth / 2;
      const dist = Math.abs(childCenter - center);
      if (dist < minDist) {
        minDist = dist;
        closest = idx;
      }
    });
    if (closest !== activeIdx) setActiveIdx(closest);
  };

  const scrollToCard = (idx: number) => {
    const el = galleryRef.current;
    if (!el) return;
    const target = el.querySelectorAll<HTMLElement>('[data-corridor-card]')[idx];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setActiveIdx(idx);
  };

  const totalCount = results.length + filteredOut.length;

  return (
    <div className="space-y-8 pb-6">
      {/* 1. 开幕海报头 */}
      <header
        className="relative overflow-hidden rounded-3xl border border-white/15 px-5 py-6 sm:px-8 sm:py-8"
        style={{
          background:
            'linear-gradient(145deg, color-mix(in srgb, var(--a) 32%, #0e1017) 0%, #0b0d13 58%, color-mix(in srgb, var(--a) 14%, #090a0f) 100%)',
        }}
      >
        {/* 胶片孔上下边框 */}
        <div className="film-perforations pointer-events-none absolute inset-x-0 top-1.5 h-2.5 opacity-30" />
        <div className="film-perforations pointer-events-none absolute inset-x-0 bottom-1.5 h-2.5 opacity-30" />

        <div className="relative z-10">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/65">
            <span style={{ color: 'var(--a)' }}>第 {edition} 届私人影展</span>
            <span>·</span>
            <span>策展人：AI</span>
            <span>·</span>
            <span>展期：今夜限定 {totalCount || 5} 部</span>
          </div>

          <h1 className="mt-3 font-serif text-2xl font-bold tracking-wide text-white sm:text-4xl">
            {meta.festivalTitle}
          </h1>
          <p className="mt-2 text-xs text-white/75 sm:text-sm">
            「{openingLine}」
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(meta.tags.length ? meta.tags : ['克制', '慢', '私藏']).map((tag) => (
              <span
                key={tag}
                className="rounded-full border px-2.5 py-0.5 font-mono text-[10px]"
                style={{
                  borderColor: 'color-mix(in srgb, var(--a) 45%, rgba(255,255,255,0.16))',
                  background: 'color-mix(in srgb, var(--a) 15%, rgba(0,0,0,0.25))',
                  color: '#f3efe6',
                }}
              >
                # {tag}
              </span>
            ))}
            <span className="ml-auto font-mono text-[10px] text-white/45">
              心愿：{query.length > 16 ? `${query.slice(0, 16)}…` : query}
            </span>
          </div>
        </div>
      </header>

      {/* 2. 展厅走廊（3D 横向吸附画廊） */}
      <section>
        <div className="mb-3 flex items-end justify-between px-1">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--a)' }}>
              EXHIBITION CORRIDOR
            </div>
            <h2 className="mt-0.5 font-serif text-lg font-bold text-white sm:text-xl">
              展厅走廊
              <span className="ml-2 font-mono text-xs font-normal text-white/45">
                {results.length > 0 ? `${safeIdx + 1} / ${results.length}` : verifying ? '试片中…' : '暂无可映片源'}
              </span>
            </h2>
          </div>
          {results.length > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="上一部展品"
                onClick={() => scrollToCard((safeIdx - 1 + results.length) % results.length)}
                className="glass flex h-8 w-8 items-center justify-center rounded-full text-sm text-white/80 hover:bg-white/15"
              >
                ‹
              </button>
              <button
                type="button"
                aria-label="下一部展品"
                onClick={() => scrollToCard((safeIdx + 1) % results.length)}
                className="glass flex h-8 w-8 items-center justify-center rounded-full text-sm text-white/80 hover:bg-white/15"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {results.length === 0 ? (
          <div className="glass rounded-2xl px-5 py-10 text-center text-xs text-white/55">
            {verifying ? '放映机正在试片，线路就绪后立即上架展品…' : '今夜这批片源均暂不可播，试试换个主题再办一场。'}
          </div>
        ) : (
          <>
            <div
              ref={galleryRef}
              onScroll={handleGalleryScroll}
              className="corridor-perspective no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-[10%] py-4 sm:px-[18%]"
            >
              {results.map((item, idx) => {
                const isCenter = idx === safeIdx;
                const offset = idx - safeIdx;
                const isFlipped = Boolean(flippedMap[item.t]);
                const decision = cardsMap[item.t];
                const isCardLoading = Boolean(loadingCard[item.t]);

                return (
                  <div
                    key={item.t}
                    data-corridor-card
                    className="w-[78vw] max-w-[300px] flex-shrink-0 snap-center transition-all duration-500 sm:w-[290px]"
                    style={{
                      transform: isCenter
                        ? 'scale(1) rotateY(0deg)'
                        : `scale(0.87) rotateY(${offset < 0 ? 14 : -14}deg)`,
                      opacity: isCenter ? 1 : 0.55,
                      filter: isCenter ? 'none' : 'blur(1px)',
                    }}
                  >
                    {/* 可翻面海报卡片 */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!isCenter) {
                          scrollToCard(idx);
                        } else {
                          toggleFlip(item);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleFlip(item);
                        }
                      }}
                      className="flip-card-scene relative aspect-[2/3] w-full cursor-pointer select-none"
                    >
                      <div className={`flip-card-inner h-full w-full ${isFlipped ? 'is-flipped' : ''}`}>
                        {/* 正面：海报 */}
                        <div
                          className="flip-card-face relative h-full w-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl"
                          style={{ background: `linear-gradient(160deg, ${item.a}55, #101219)` }}
                        >
                          {item.poster && (
                            <CinemaImg
                              src={item.poster}
                              loading={idx < 2 ? 'eager' : 'lazy'}
                              decoding="async"
                              className="h-full w-full object-cover"
                            />
                          )}
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#08090b] via-transparent to-black/35" />

                          <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-0.5 font-mono text-[10px] tracking-wider text-white/90 backdrop-blur-md">
                            No.{String(idx + 1).padStart(2, '0')}
                          </div>
                          <div className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] text-white/80 backdrop-blur-md">
                            点击翻面 ↻
                          </div>

                          <div className="absolute inset-x-3 bottom-3">
                            <p className="line-clamp-2 font-serif text-xs italic text-white/90">
                              「{item.note || item.w}」
                            </p>
                          </div>
                        </div>

                        {/* 背面：策展人手记 + 决策卡要点 */}
                        <div
                          className="flip-card-face flip-card-back flex h-full w-full flex-col justify-between overflow-y-auto rounded-2xl border p-4 text-left shadow-2xl"
                          style={{
                            borderColor: 'color-mix(in srgb, var(--a) 45%, rgba(255,255,255,0.14))',
                            background: 'linear-gradient(165deg, #131620, #0b0d12)',
                          }}
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--a)' }}>
                                CURATOR&apos;S NOTE · No.{String(idx + 1).padStart(2, '0')}
                              </span>
                              <span className="font-mono text-[10px] text-white/45">点击翻回 ↺</span>
                            </div>

                            <div>
                              <h3 className="font-serif text-base font-bold text-white">{item.t}</h3>
                              <p className="mt-1 text-xs leading-relaxed text-[#f3efe6]/85">{item.w}</p>
                            </div>

                            <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 text-[11px]">
                              <div className="mb-1.5 flex items-center justify-between font-mono text-[10px]" style={{ color: 'var(--a)' }}>
                                <span>✦ 决策卡要点</span>
                                {isCardLoading && <span className="text-white/45">提炼中…</span>}
                              </div>
                              {decision ? (
                                <div className="space-y-1.5">
                                  <p className="text-white/85"><span className="text-white/45">看点：</span>{decision.p}</p>
                                  <p className="text-white/75"><span className="text-white/45">注意：</span>{decision.c}</p>
                                  {decision.f.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                      {decision.f.slice(0, 3).map((tag) => (
                                        <span key={tag} className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] text-white/85">
                                          {tag}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p className="text-white/60">
                                  {isCardLoading ? '策展人正在整理看点与劝退点…' : item.note || '适合安静看完的私人影展选片。'}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onPlayNow(item);
                              }}
                              className="flex-1 rounded-full py-2 text-xs font-semibold text-[#08090b] transition active:scale-95"
                              style={{ background: 'var(--a)' }}
                            >
                              ▶ 立即放映
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenDetail(item);
                              }}
                              className="glass rounded-full px-3 py-2 text-xs text-white/85 hover:bg-white/15"
                            >
                              选线路
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* 博物馆式展签 */}
                    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 backdrop-blur-md">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] tracking-widest text-white/45">
                            No.{String(idx + 1).padStart(2, '0')} · {item.y || '精选'} · {item.s} 条线路
                          </div>
                          <h3 className="mt-0.5 truncate font-serif text-base font-bold text-white">
                            {item.t}
                          </h3>
                        </div>
                        {/* 匹配度光环 */}
                        <MatchRing value={item.match} />
                      </div>
                      <p className="mt-1.5 line-clamp-1 text-[11px] text-white/65">
                        {item.note || item.w}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-1 text-center font-mono text-[10px] text-white/40">
              左右滑动切换展品并联动主题色 · 点击海报翻面查看策展手记与决策卡
            </p>
          </>
        )}
      </section>

      {/* 3. 今夜场次表（锯齿票根 + 条码，点击直放，左滑收藏） */}
      {results.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between px-1">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--a)' }}>
                TONIGHT&apos;S SCREENINGS
              </div>
              <h2 className="mt-0.5 font-serif text-lg font-bold text-white sm:text-xl">
                今夜场次表
              </h2>
            </div>
            <span className="font-mono text-[10px] text-white/45">点票根直接播放 · 左滑收藏</span>
          </div>

          <div className="space-y-2.5">
            {results.map((item, idx) => (
              <ScreeningTicketRow
                key={item.t}
                item={item}
                hallNo={idx + 1}
                showTime={screeningTimes[idx] || '21:40'}
                favorited={favorites.includes(item.t)}
                onPlay={() => onPlayNow(item)}
                onToggleFavorite={() => toggleFavorite(item.t)}
              />
            ))}
          </div>
        </section>
      )}

      {/* 4. 策展人手记（三段式分段打字机） */}
      <CuratorNotesSection notes={notes} />

      {/* 5. 撤展名单（划掉的票根）与闭幕 */}
      {filteredOut.length > 0 && (
        <section>
          <div className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
            WITHDRAWN · 撤展名单
          </div>
          <div className="space-y-2">
            {filteredOut.map((title) => (
              <div
                key={title}
                className="ticket-stub relative flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-white/45"
              >
                <div className="min-w-0">
                  <div className="truncate font-serif text-sm line-through decoration-red-400/70 decoration-2">
                    《{title}》线路不可用，已撤展
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/35">{withdrawLine}</p>
                </div>
                <span className="flex-shrink-0 -rotate-6 rounded border border-red-400/40 px-2 py-0.5 font-mono text-[10px] tracking-widest text-red-300/70">
                  已撤展
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 闭幕：再办一场 */}
      <footer className="flex flex-col items-center rounded-3xl border border-white/10 bg-white/[0.03] px-5 py-6 text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
          CURTAIN CALL · 闭幕
        </div>
        <p className="mt-1.5 font-serif text-sm text-white/75">
          意犹未尽？换一种情绪或关键词，为你重新布展。
        </p>
        <button
          type="button"
          onClick={onResetFestival}
          className="mt-4 rounded-full px-6 py-2.5 text-xs font-semibold text-[#08090b] transition hover:brightness-110 active:scale-95"
          style={{ background: 'var(--a)' }}
        >
          ✦ 再办一场
        </button>
      </footer>
    </div>
  );
}

/** 匹配度光环 */
function MatchRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const r = 15;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct / 100);
  return (
    <div className="relative flex h-10 w-10 flex-shrink-0 items-center justify-center">
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--a)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute font-mono text-[9px] font-semibold text-white/90">{pct}%</span>
    </div>
  );
}

/** 场次票根（锯齿边 + 条码 + 点击直放 + 左滑收藏） */
function ScreeningTicketRow({
  item,
  hallNo,
  showTime,
  favorited,
  onPlay,
  onToggleFavorite,
}: {
  item: FestivalMovieItem;
  hallNo: number;
  showTime: string;
  favorited: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
}) {
  const [offsetX, setOffsetX] = useState(0);
  const startXRef = useRef<number | null>(null);
  const swipedRef = useRef(false);

  const onTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    swipedRef.current = false;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (startXRef.current === null) return;
    const dx = e.touches[0].clientX - startXRef.current;
    if (dx < -8) {
      swipedRef.current = true;
      setOffsetX(Math.max(-88, dx));
    } else if (dx > 8 && offsetX < 0) {
      setOffsetX(Math.min(0, offsetX + dx));
    }
  };

  const onTouchEnd = () => {
    if (offsetX <= -54) {
      onToggleFavorite();
    }
    setOffsetX(0);
    startXRef.current = null;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* 左滑露出的收藏底槽 */}
      <div
        className="absolute inset-y-0 right-0 flex w-24 items-center justify-center rounded-r-2xl text-xs font-medium text-[#08090b]"
        style={{ background: 'var(--a)' }}
      >
        {favorited ? '取消收藏' : '♥ 收藏'}
      </div>

      <div
        role="button"
        tabIndex={0}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={() => {
          if (swipedRef.current) {
            swipedRef.current = false;
            return;
          }
          onPlay();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onPlay();
          }
        }}
        className="ticket-stub relative flex cursor-pointer items-stretch rounded-2xl border border-white/12 bg-[#11141c] transition-transform duration-200 hover:border-white/25"
        style={{ transform: `translate3d(${offsetX}px, 0, 0)` }}
      >
        {/* 左侧场次时间 */}
        <div className="flex w-20 flex-shrink-0 flex-col items-center justify-center border-r border-dashed border-white/15 px-2 py-3 text-center sm:w-24">
          <span className="font-mono text-base font-bold tracking-tight" style={{ color: 'var(--a)' }}>
            {showTime}
          </span>
          <span className="mt-0.5 font-mono text-[9px] text-white/45">
            {String(hallNo).padStart(2, '0')} 号厅
          </span>
        </div>

        {/* 中部片名与线路 */}
        <div className="flex min-w-0 flex-1 flex-col justify-center px-3.5 py-3">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-serif text-sm font-bold text-white sm:text-base">{item.t}</h3>
            {favorited && (
              <span className="flex-shrink-0 text-xs" style={{ color: 'var(--a)' }} aria-label="已收藏">
                ♥
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-white/50">
            {item.y || '精选'} · {item.s} 条线路待命 · {item.match}% 契合
          </div>
        </div>

        {/* 右侧条码 + 收藏快捷按钮 + 播放图标 */}
        <div className="flex flex-shrink-0 items-center gap-2.5 pr-3.5">
          <button
            type="button"
            aria-label={favorited ? '取消收藏' : '收藏此场次'}
            title={favorited ? '取消收藏' : '收藏此场次'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            className="hidden h-7 w-7 items-center justify-center rounded-full border border-white/10 text-xs text-white/60 transition hover:border-white/30 hover:text-white sm:flex"
            style={favorited ? { color: 'var(--a)', borderColor: 'var(--a)' } : undefined}
          >
            {favorited ? '♥' : '♡'}
          </button>
          <TicketBarcode seed={item.t} />
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-[#08090b]"
            style={{ background: 'var(--a)' }}
          >
            ▶
          </span>
        </div>
      </div>
    </div>
  );
}

/** 轻量 SVG 票根条码 */
function TicketBarcode({ seed }: { seed: string }) {
  const bars = useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Array.from({ length: 12 }, (_, i) => (((h >>> (i * 2)) & 3) % 2) + 1);
  }, [seed]);

  let x = 0;
  return (
    <svg viewBox="0 0 28 24" className="hidden h-6 w-7 text-white/35 sm:block" aria-hidden="true">
      {bars.map((w, i) => {
        const curX = x;
        x += w + 1.2;
        return <rect key={i} x={curX} y="2" width={w} height="20" fill="currentColor" />;
      })}
    </svg>
  );
}

/** 策展人手记（拆成策展词、观看建议、今夜片单三小段，分段打字机） */
function CuratorNotesSection({ notes }: { notes: CuratorNotes }) {
  const segments = useMemo(
    () => [
      { key: 'preface', label: '策展词', text: notes.preface },
      { key: 'advice', label: '观看建议', text: notes.advice },
      { key: 'lineup', label: '今夜片单', text: notes.lineup },
    ],
    [notes.preface, notes.advice, notes.lineup]
  );

  const [typed, setTyped] = useState<[string, string, string]>(['', '', '']);

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setTyped([segments[0].text, segments[1].text, segments[2].text]);
      return;
    }

    let segIdx = 0;
    let charIdx = 0;
    setTyped(['', '', '']);

    const id = window.setInterval(() => {
      if (segIdx >= segments.length) {
        window.clearInterval(id);
        return;
      }
      const full = segments[segIdx].text;
      charIdx += 2;
      const nextSlice = full.slice(0, charIdx);
      setTyped((prev) => {
        const copy: [string, string, string] = [...prev];
        copy[segIdx] = nextSlice;
        return copy;
      });
      if (charIdx >= full.length) {
        segIdx += 1;
        charIdx = 0;
      }
    }, 34);

    return () => window.clearInterval(id);
  }, [segments]);

  return (
    <section className="glass rounded-3xl p-5 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: 'var(--a)' }}>
            CURATOR&apos;S NOTES
          </div>
          <h2 className="mt-0.5 font-serif text-lg font-bold text-white">策展人手记</h2>
        </div>
        <span className="font-mono text-[10px] text-white/40">AI 策展人手写</span>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
        {segments.map((seg, idx) => (
          <div key={seg.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="font-mono text-[10px] tracking-wider" style={{ color: 'var(--a)' }}>
              0{idx + 1} · {seg.label}
            </div>
            <p className="mt-2 min-h-[3.2rem] text-xs leading-relaxed text-[#f3efe6]/90">
              {typed[idx]}
              {typed[idx].length > 0 && typed[idx].length < seg.text.length && (
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse align-middle" style={{ background: 'var(--a)' }} />
              )}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
