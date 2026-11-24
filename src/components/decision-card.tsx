'use client';

import { useEffect, useState } from 'react';

export interface DecisionCardData {
  p: string;
  c: string;
  f: string[];
  recap: string;
}

/** 紧凑两列 30 秒决策卡。播放页和影展预览共用。 */
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
  const [card, setCard] = useState<DecisionCardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!title) return;
    const ac = new AbortController();
    setLoading(true);
    setCard(null);
    fetch('/api/ai/decision-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, year, overview }),
      signal: ac.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          window.dispatchEvent(new CustomEvent('libretv:unauthorized'));
          return null;
        }
        if (!res.ok) return null;
        return (await res.json()) as DecisionCardData;
      })
      .then((data) => { if (data?.p) setCard(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [title, year, overview]);

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-wider text-[#e86f51]">✦ 30 秒 AI 决策卡</span>
        {loading && <span className="font-mono text-[10px] text-white/40">生成中...</span>}
      </div>
      {card && (
        <div className={compact ? 'mt-2 grid grid-cols-2 gap-3' : 'mt-2 space-y-2'}>
          <div>
            <div className="text-white/45">核心看点</div>
            <p className="mt-0.5 text-[#f3efe6]/90">{card.p}</p>
          </div>
          <div>
            <div className="text-white/45">潜在劝退</div>
            <p className="mt-0.5 text-[#f3efe6]/80">{card.c}</p>
          </div>
          <div className={compact ? 'col-span-2' : ''}>
            <div className="text-white/45">适合人群</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {card.f.map((tag) => (
                <span key={tag} className="rounded bg-white/10 px-2 py-0.5 text-[10px]">{tag}</span>
              ))}
            </div>
          </div>
          {open && <p className={compact ? 'col-span-2 border-t border-white/10 pt-2 text-white/75' : 'border-t border-white/10 pt-2 text-white/75'}>{card.recap}</p>}
          <button type="button" className={compact ? 'col-span-2 text-left text-[11px] text-white/60' : 'text-left text-[11px] text-white/60'} onClick={() => setOpen((v) => !v)}>
            {open ? '收起前情提要' : '前情提要'}
          </button>
        </div>
      )}
    </div>
  );
}
