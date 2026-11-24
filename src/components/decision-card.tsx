'use client';

import { useEffect, useState } from 'react';
import {
  fetchDecisionCardCached,
  getCachedDecisionCard,
  type DecisionCardData,
} from '@/lib/decision-card-cache';

export type { DecisionCardData };

/** 紧凑两列 30 秒决策卡。播放页和影展预览共用，命中本地缓存 0 网络请求、0 Token。 */
export function DecisionCard({
  title,
  year,
  overview,
  compact = false,
}: {
  title: string;
  year?: string | number;
  overview?: string;
  compact?: boolean;
}) {
  const [card, setCard] = useState<DecisionCardData | null>(() =>
    title ? getCachedDecisionCard(title, year) : null
  );
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!title) return;
    const cached = getCachedDecisionCard(title, year);
    if (cached) {
      setCard(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setCard(null);
    void fetchDecisionCardCached({ title, year, overview })
      .then((data) => {
        if (!cancelled && data?.p) setCard(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [title, year, overview]);

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-xs backdrop-blur-md">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-wider" style={{ color: 'var(--a)' }}>
          ✦ 30 秒 AI 决策卡
        </span>
        {loading && <span className="font-mono text-[10px] text-white/40">提炼中...</span>}
      </div>
      {card && (
        <div className={compact ? 'mt-2 grid grid-cols-2 gap-3' : 'mt-2 space-y-2'}>
          <div>
            <div className="text-white/45">核心看点</div>
            <p className="mt-0.5 leading-relaxed text-[#f3efe6]/90">{card.p}</p>
          </div>
          <div>
            <div className="text-white/45">潜在劝退</div>
            <p className="mt-0.5 leading-relaxed text-[#f3efe6]/80">{card.c}</p>
          </div>
          <div className={compact ? 'col-span-2' : ''}>
            <div className="text-white/45">适合人群</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {card.f.map((tag) => (
                <span key={tag} className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-white/90">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          {open && card.recap && (
            <p className={compact ? 'col-span-2 border-t border-white/10 pt-2 leading-relaxed text-white/75' : 'border-t border-white/10 pt-2 leading-relaxed text-white/75'}>
              {card.recap}
            </p>
          )}
          {card.recap && (
            <button
              type="button"
              className={compact ? 'col-span-2 text-left text-[11px] text-white/60 hover:text-white/85' : 'text-left text-[11px] text-white/60 hover:text-white/85'}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? '收起前情提要 ▴' : '查看前情提要 ▾'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
