'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { extractQueryKeywords, type CurateMeta } from '@/lib/curate-presets';

export interface StageMovieStatus {
  title: string;
  status: 'pending' | 'ready' | 'withdrawn';
}

interface CurateStageProps {
  query: string;
  sseStep: number;
  meta: CurateMeta;
  pickedCount: number;
  verifiedMovies: StageMovieStatus[];
  openingLine: string;
  onSkip: () => void;
  onOpeningComplete: () => void;
}

const FILM_STEPS = [
  { id: 'intent', code: '01', label: '收到邀请函' },
  { id: 'mood', code: '02', label: '灯光调色' },
  { id: 'match', code: '03', label: '胶片库' },
  { id: 'verify', code: '04', label: '放映机试片' },
] as const;

const MIN_DWELL_MS = [1500, 1500, 1500, 1600] as const;
const CURTAIN_MS = 1050;

/**
 * 全屏影展筹备舞台（约 7 秒，纯 CSS/SVG + 时间线，零第三方动画库）。
 * 真实 SSE 事件到达且满足最短停留时长后才推进下一场景，避免闪过；支持随时点击跳过与减少动态效果降级。
 */
export function CurateStage({
  query,
  sseStep,
  meta,
  pickedCount,
  verifiedMovies,
  openingLine,
  onSkip,
  onOpeningComplete,
}: CurateStageProps) {
  const [scene, setScene] = useState<number>(0);
  const [dwellDone, setDwellDone] = useState<boolean>(false);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const [scanNum, setScanNum] = useState<number>(0);
  const completedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // 减少动态效果模式：静态四步图标，后端就绪后直接进入结果页
  useEffect(() => {
    if (!reducedMotion || sseStep < 4 || completedRef.current) return;
    const t = window.setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onOpeningComplete();
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [reducedMotion, sseStep, onOpeningComplete]);

  // 每个场景的最短停留计时器
  useEffect(() => {
    if (reducedMotion) return;
    if (scene >= 4) {
      const t = window.setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onOpeningComplete();
        }
      }, CURTAIN_MS);
      return () => window.clearTimeout(t);
    }
    setDwellDone(false);
    const t = window.setTimeout(() => setDwellDone(true), MIN_DWELL_MS[scene] ?? 1500);
    return () => window.clearTimeout(t);
  }, [scene, reducedMotion, onOpeningComplete]);

  // 当最短时长已过且真实 SSE/校验步进到达目标时，推进下一幕
  useEffect(() => {
    if (reducedMotion || scene >= 4 || !dwellDone) return;
    const neededSseStep = scene + 1;
    if (sseStep >= neededSseStep) {
      setScene((s) => Math.min(4, s + 1));
    }
  }, [scene, dwellDone, sseStep, reducedMotion]);

  // 场景 3（胶片库）：数字滚动「扫描 N 部」
  useEffect(() => {
    if (scene !== 2 || reducedMotion) return;
    const target = Math.max(24, meta.totalCatalog || 128);
    let raf = 0;
    const start = performance.now();
    const duration = 1150;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) * (1 - p);
      setScanNum(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene, meta.totalCatalog, reducedMotion]);

  const keywords = useMemo(
    () => extractQueryKeywords(query, meta.tags),
    [query, meta.tags]
  );

  const readyCount = verifiedMovies.filter((m) => m.status === 'ready').length;
  const withdrawnCount = verifiedMovies.filter((m) => m.status === 'withdrawn').length;
  const totalVerify = Math.max(verifiedMovies.length, pickedCount || 5);
  const shortQuery = query.length > 22 ? `${query.slice(0, 22)}…` : query;

  // 系统开启「减少动态效果」时退化为静态四步图标
  if (reducedMotion) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#08090b] px-6 text-[#f3efe6]">
        <button
          type="button"
          onClick={onSkip}
          className="glass absolute right-5 top-5 rounded-full px-3.5 py-1.5 text-xs text-white/75 hover:text-white"
        >
          跳过 ›
        </button>
        <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em]" style={{ color: 'var(--a)' }}>
          PRIVATE CINEMA CURATING
        </div>
        <h2 className="mb-6 text-center font-serif text-xl font-bold">{meta.festivalTitle}</h2>
        <div className="grid w-full max-w-md grid-cols-4 gap-3">
          {FILM_STEPS.map((st, idx) => {
            const done = sseStep > idx;
            const active = sseStep === idx;
            return (
              <div
                key={st.id}
                className="flex flex-col items-center rounded-2xl border px-2 py-3 text-center"
                style={{
                  borderColor: done || active ? 'var(--a)' : 'rgba(255,255,255,0.12)',
                  background: done || active ? 'color-mix(in srgb, var(--a) 14%, transparent)' : 'rgba(255,255,255,0.03)',
                }}
              >
                <span className="font-mono text-xs font-semibold" style={{ color: done || active ? 'var(--a)' : 'rgba(255,255,255,0.4)' }}>
                  {done ? '✓' : st.code}
                </span>
                <span className="mt-1.5 text-[11px] text-white/85">{st.label}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-xs text-white/60">正在为你筹备今夜的私人影展…</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#07080b] text-[#f3efe6]"
      style={{ '--stage-a': meta.themeColor } as React.CSSProperties}
    >
      {/* 顶部四格胶片进度条 + 跳过按钮 */}
      <div className="relative z-30 mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <div className="flex flex-1 items-center gap-1.5 rounded-xl border border-white/10 bg-black/50 p-1.5 backdrop-blur-md">
          {FILM_STEPS.map((st, idx) => {
            const lit = scene === idx;
            const passed = scene > idx;
            return (
              <div
                key={st.id}
                className="relative flex flex-1 flex-col items-center overflow-hidden rounded-lg border px-1.5 py-1.5 transition-all duration-500"
                style={{
                  borderColor: lit ? 'var(--a)' : passed ? 'color-mix(in srgb, var(--a) 45%, transparent)' : 'rgba(255,255,255,0.08)',
                  background: lit
                    ? 'color-mix(in srgb, var(--a) 22%, rgba(12,13,18,0.85))'
                    : passed
                      ? 'color-mix(in srgb, var(--a) 10%, rgba(12,13,18,0.75))'
                      : 'rgba(255,255,255,0.03)',
                }}
              >
                {/* 胶片齿孔装饰 */}
                <div className="mb-1 flex w-full justify-between opacity-35">
                  <span className="h-1 w-1 rounded-[1px] bg-white" />
                  <span className="h-1 w-1 rounded-[1px] bg-white" />
                  <span className="h-1 w-1 rounded-[1px] bg-white" />
                </div>
                <span
                  className="truncate font-mono text-[10px] tracking-wider"
                  style={{ color: lit || passed ? '#fff' : 'rgba(255,255,255,0.38)' }}
                >
                  {st.code} {st.label}
                </span>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="glass flex-shrink-0 rounded-full px-3.5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/15 hover:text-white active:scale-95"
        >
          跳过 ›
        </button>
      </div>

      {/* 中央连贯镜头轨道：4 个后台筹备场景横移串联 */}
      <div className="relative flex flex-1 items-center overflow-hidden">
        {/* 氛围背景光晕 */}
        <div
          className="pointer-events-none absolute inset-0 transition-all duration-700"
          style={{
            background:
              scene === 0
                ? 'radial-gradient(60% 45% at 50% 45%, rgba(255,255,255,0.06), transparent 70%)'
                : `radial-gradient(65% 50% at 50% 42%, color-mix(in srgb, var(--a) 26%, transparent), transparent 72%)`,
          }}
        />

        <div
          className="stage-camera-track flex h-full w-[400%] flex-shrink-0"
          style={{
            transform: `translate3d(-${Math.min(3, scene) * 25}%, 0, 0) scale(${scene === 4 ? 1.06 : 1})`,
          }}
        >
          {/* 场景 1：收到邀请函 */}
          <section className="flex w-1/4 flex-col items-center justify-center px-6">
            <div className="relative flex h-64 w-full max-w-sm flex-col items-center justify-center">
              {/* 信封与抽出的票根 */}
              <div className="relative mt-6 w-64">
                {/* 抽出的票根 */}
                <div
                  className={`relative z-10 mx-auto w-56 rounded-xl border border-white/20 bg-[#141720] px-4 py-3.5 shadow-2xl ${
                    scene === 0 ? 'stage-ticket-rise' : ''
                  }`}
                >
                  <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-white/45">
                    <span>INVITATION · 观众心愿</span>
                    <span style={{ color: 'var(--a)' }}>ADMIT ONE</span>
                  </div>
                  <p className="mt-2 font-serif text-sm leading-snug text-[#f3efe6]">
                    「{shortQuery}」
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {keywords.map((kw, i) => (
                      <span
                        key={kw}
                        className="stage-keyword-ring rounded-full border px-2 py-0.5 text-[10px]"
                        style={{
                          borderColor: 'var(--a)',
                          color: 'var(--a)',
                          animationDelay: `${450 + i * 220}ms`,
                        }}
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                {/* 信封主体 */}
                <svg
                  viewBox="0 0 260 110"
                  className="relative z-20 -mt-5 w-full drop-shadow-xl"
                  fill="none"
                >
                  <rect x="6" y="18" width="248" height="86" rx="10" fill="#101219" stroke="rgba(255,255,255,0.16)" strokeWidth="1.2" />
                  <path d="M10 22 L130 72 L250 22" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
                  <path
                    d="M10 22 L130 4 L250 22"
                    fill="#181b25"
                    stroke="rgba(255,255,255,0.15)"
                    strokeWidth="1.2"
                    className={scene === 0 ? 'stage-envelope-flap' : ''}
                  />
                  <circle cx="130" cy="64" r="9" fill="var(--a)" fillOpacity="0.88" />
                  <text x="130" y="67.5" textAnchor="middle" fill="#08090b" fontSize="9" fontWeight="700">✦</text>
                </svg>
              </div>
            </div>

            <div className="mt-2 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">SCENE 01 · 收到邀请函</div>
              <p className="mt-2 max-w-md font-serif text-base text-[#f3efe6]/95 sm:text-lg">
                「收到一位观众的心愿：{shortQuery}」
              </p>
            </div>
          </section>

          {/* 场景 2：灯光调色 */}
          <section className="flex w-1/4 flex-col items-center justify-center px-6">
            <div className="relative flex h-64 w-full max-w-sm items-center justify-center">
              {/* 聚光灯锥 */}
              <div
                className={`pointer-events-none absolute top-0 h-56 w-64 ${scene === 1 ? 'stage-spotlight-sweep' : ''}`}
                style={{
                  background: 'conic-gradient(from 160deg at 50% 0%, transparent 0deg, color-mix(in srgb, var(--a) 38%, transparent) 22deg, transparent 44deg)',
                  filter: 'blur(8px)',
                }}
              />
              {/* 顶部灯具 */}
              <div className="absolute top-2 flex flex-col items-center">
                <div className="h-3 w-12 rounded-b-full border border-white/25 bg-[#1b1f2b]" />
                <div className="h-1.5 w-6 rounded-full" style={{ background: 'var(--a)', boxShadow: '0 0 18px var(--a)' }} />
              </div>

              {/* 吸附到灯下的情绪色卡光斑 */}
              <div className="relative z-10 mt-10 flex flex-wrap items-center justify-center gap-3">
                {(meta.tags.length ? meta.tags : ['克制', '潮湿', '慢']).slice(0, 4).map((tag, idx) => (
                  <div
                    key={tag}
                    className={`flex items-center gap-2 rounded-2xl border px-3.5 py-2 backdrop-blur-md ${
                      scene === 1 ? 'stage-swatch-magnet' : ''
                    }`}
                    style={{
                      animationDelay: `${idx * 180}ms`,
                      borderColor: 'color-mix(in srgb, var(--a) 55%, rgba(255,255,255,0.16))',
                      background: 'color-mix(in srgb, var(--a) 16%, rgba(14,16,22,0.85))',
                      boxShadow: '0 8px 24px color-mix(in srgb, var(--a) 22%, transparent)',
                    }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--a)' }} />
                    <span className="font-serif text-sm font-medium text-white">{tag}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">SCENE 02 · 灯光调色</div>
              <p className="mt-2 max-w-md font-serif text-base text-[#f3efe6]/95 sm:text-lg">
                「灯光师在调色：{(meta.tags.length ? meta.tags : ['克制', '潮湿', '慢']).join('、')}」
              </p>
            </div>
          </section>

          {/* 场景 3：胶片库 */}
          <section className="flex w-1/4 flex-col items-center justify-center px-6">
            <div className="relative flex h-64 w-full max-w-md flex-col items-center justify-center">
              <div className="mb-4 font-mono text-xs tracking-widest text-white/60">
                扫描 <span className="text-lg font-bold" style={{ color: 'var(--a)' }}>{scanNum || meta.totalCatalog}</span> 部馆藏片盒
              </div>
              <div className="relative grid w-full max-w-xs grid-cols-5 gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                {/* 扫描线 */}
                {scene === 2 && <div className="stage-scanline pointer-events-none absolute inset-y-2 left-0 w-10" />}
                {Array.from({ length: 10 }).map((_, idx) => {
                  const selected = idx % 2 === 0;
                  return (
                    <div
                      key={idx}
                      className={`flex h-14 flex-col items-center justify-between rounded-lg border p-1.5 transition-all duration-500 ${
                        selected && scene >= 2 ? '-translate-y-1.5 scale-105' : 'opacity-45'
                      }`}
                      style={{
                        borderColor: selected && scene >= 2 ? 'var(--a)' : 'rgba(255,255,255,0.12)',
                        background:
                          selected && scene >= 2
                            ? 'color-mix(in srgb, var(--a) 22%, #131620)'
                            : '#101218',
                        boxShadow:
                          selected && scene >= 2
                            ? '0 6px 18px color-mix(in srgb, var(--a) 28%, transparent)'
                            : 'none',
                      }}
                    >
                      <span className="h-1 w-5 rounded-full bg-white/25" />
                      <span className="h-4 w-4 rounded-full border border-white/30" />
                      <span className="font-mono text-[8px] text-white/55">
                        {selected ? `0${idx / 2 + 1}` : '··'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-2 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">SCENE 03 · 胶片库</div>
              <p className="mt-2 max-w-md font-serif text-base text-[#f3efe6]/95 sm:text-lg">
                「在 {meta.totalCatalog || 128} 部里，留下 {pickedCount || 5} 部」
              </p>
            </div>
          </section>

          {/* 场景 4：放映机试片 */}
          <section className="flex w-1/4 flex-col items-center justify-center px-6">
            <div className="relative flex h-64 w-full max-w-md flex-col items-center justify-center">
              {/* 放映机 + 光束 */}
              <div className="mb-4 flex items-center gap-3">
                <svg viewBox="0 0 88 54" className="h-12 w-20 text-white/80" fill="none">
                  <circle cx="24" cy="18" r="11" stroke="currentColor" strokeWidth="1.6" className={scene === 3 ? 'stage-reel-spin' : ''} style={{ transformOrigin: '24px 18px' }} />
                  <circle cx="50" cy="18" r="11" stroke="currentColor" strokeWidth="1.6" className={scene === 3 ? 'stage-reel-spin' : ''} style={{ transformOrigin: '50px 18px' }} />
                  <rect x="14" y="28" width="46" height="20" rx="4" fill="#161923" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M60 33 L74 28 L74 48 L60 43 Z" fill="var(--a)" fillOpacity="0.85" />
                </svg>
                <div
                  className={`h-8 w-28 rounded-r-full ${scene === 3 ? 'stage-beam-flicker' : ''}`}
                  style={{
                    background: 'linear-gradient(90deg, color-mix(in srgb, var(--a) 45%, transparent), transparent)',
                  }}
                />
              </div>

              {/* 5 格试片胶片条 */}
              <div className="grid w-full max-w-sm grid-cols-5 gap-2">
                {(verifiedMovies.length
                  ? verifiedMovies
                  : Array.from({ length: totalVerify }, (_, i) => ({
                      title: `试片 0${i + 1}`,
                      status: 'pending' as const,
                    }))
                )
                  .slice(0, 5)
                  .map((item, idx) => (
                    <div
                      key={`${item.title}-${idx}`}
                      className={`relative flex h-24 flex-col items-center justify-between rounded-lg border p-1.5 text-center transition-all duration-500 ${
                        item.status === 'withdrawn' ? 'stage-film-cut opacity-45 grayscale' : ''
                      }`}
                      style={{
                        borderColor:
                          item.status === 'ready'
                            ? 'var(--a)'
                            : item.status === 'withdrawn'
                              ? 'rgba(255,255,255,0.12)'
                              : 'rgba(255,255,255,0.2)',
                        background:
                          item.status === 'ready'
                            ? 'color-mix(in srgb, var(--a) 16%, #12151e)'
                            : '#101218',
                      }}
                    >
                      <span className="font-mono text-[8px] text-white/45">0{idx + 1}</span>
                      <span className="line-clamp-2 text-[10px] leading-tight text-white/85">{item.title}</span>
                      <span
                        className={`rounded px-1 py-0.5 font-mono text-[8px] font-semibold ${
                          item.status === 'ready' ? 'stage-stamp-in' : ''
                        }`}
                        style={{
                          background:
                            item.status === 'ready'
                              ? 'var(--a)'
                              : item.status === 'withdrawn'
                                ? 'rgba(239,68,68,0.25)'
                                : 'rgba(255,255,255,0.08)',
                          color:
                            item.status === 'ready'
                              ? '#08090b'
                              : item.status === 'withdrawn'
                                ? '#fca5a5'
                                : 'rgba(255,255,255,0.55)',
                        }}
                      >
                        {item.status === 'ready' ? '通过' : item.status === 'withdrawn' ? '撤展' : '试映'}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div className="mt-2 text-center">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">SCENE 04 · 放映机试片</div>
              <p className="mt-2 max-w-md font-serif text-base text-[#f3efe6]/95 sm:text-lg">
                「{totalVerify} 部试映，{readyCount} 部线路待命{withdrawnCount > 0 ? `，${withdrawnCount} 部撤展` : ''}」
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* 幕布拉开（开幕过渡） */}
      {scene === 4 && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center overflow-hidden">
          <div
            className="stage-curtain-left absolute inset-y-0 left-0 w-1/2"
            style={{
              background: 'linear-gradient(135deg, color-mix(in srgb, var(--a) 45%, #0b0d12), #08090b)',
              borderRight: '1px solid color-mix(in srgb, var(--a) 40%, transparent)',
            }}
          />
          <div
            className="stage-curtain-right absolute inset-y-0 right-0 w-1/2"
            style={{
              background: 'linear-gradient(225deg, color-mix(in srgb, var(--a) 45%, #0b0d12), #08090b)',
              borderLeft: '1px solid color-mix(in srgb, var(--a) 40%, transparent)',
            }}
          />
          <div className="stage-opening-title relative z-10 px-6 text-center">
            <div className="font-mono text-xs uppercase tracking-[0.35em]" style={{ color: 'var(--a)' }}>
              今夜开幕
            </div>
            <h1 className="mt-2 font-serif text-3xl font-bold tracking-wide text-white sm:text-4xl">
              {meta.festivalTitle}
            </h1>
            <p className="mt-2 text-xs text-white/70">{openingLine}</p>
          </div>
        </div>
      )}
    </div>
  );
}
