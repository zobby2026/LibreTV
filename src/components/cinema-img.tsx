'use client';

import { useEffect, useMemo, useState } from 'react';

interface CinemaImgProps {
  src?: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'auto' | 'sync';
  fetchPriority?: 'high' | 'low' | 'auto';
  draggable?: boolean;
}

const DOUBAN_PROXY_PREFIX = '/api/img?url=';

/**
 * 构建图片候选加载链：
 * - 若为豆瓣反代地址（/api/img?url=https://img*.doubanio.com/...），优先用 no-referrer
 *   直连国内豆瓣 CDN（省去 Cloudflare 回源一跳，速度最快），失败再回退 Worker 反代。
 * - 其余地址直接加载。
 */
function buildCandidates(src?: string): string[] {
  if (!src) return [];
  if (src.startsWith(DOUBAN_PROXY_PREFIX)) {
    try {
      const raw = decodeURIComponent(src.slice(DOUBAN_PROXY_PREFIX.length));
      if (/^https?:\/\/img\d+\.doubanio\.com\//i.test(raw)) {
        const httpsUrl = raw.replace(/^http:\/\//i, 'https://');
        return [httpsUrl, src];
      }
    } catch {
      /* 解码失败直接走原地址 */
    }
  }
  return [src];
}

export function CinemaImg({
  src,
  alt = '',
  className,
  loading = 'lazy',
  decoding = 'async',
  fetchPriority,
  draggable,
}: CinemaImgProps) {
  const candidates = useMemo(() => buildCandidates(src), [src]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [src]);

  const current = candidates[idx];
  if (!current) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt={alt}
      loading={loading}
      decoding={decoding}
      fetchPriority={fetchPriority}
      draggable={draggable}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setIdx((i) => i + 1)}
    />
  );
}
