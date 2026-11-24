import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { buildDiscover, filterFallback, parseLibraryQuery, type CatalogItem } from '@/lib/catalog';
import { withEdgeCache } from '@/lib/edge-cache';

export const runtime = 'nodejs';

const PALETTE = [
  ['#e86f51', '#2b130e'], ['#5ea8ff', '#0d1b2a'], ['#f4a261', '#2a1a0c'],
  ['#b28cff', '#1b112e'], ['#4ecdc4', '#0b2220'], ['#ff6b8b', '#2b0f18'],
  ['#ffd27a', '#29200b'], ['#7ae582', '#0d2412'], ['#ff8c42', '#2b1608'],
  ['#6ee7ff', '#0b2026'],
];

/** GET /api/library — 透传 TMDB discover，12 小时边缘缓存。没有 key 时返回内置片单。 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const query = parseLibraryQuery(new URL(req.url));
  return withEdgeCache(req, 60 * 60 * 12, async () => {
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      return NextResponse.json({ ...filterFallback(query), source: 'fallback' });
    }
    const { endpoint, params } = buildDiscover(query);
    const headers: Record<string, string> = { Accept: 'application/json' };
    // v4 读令牌是 JWT（eyJ 开头），必须放 Bearer；v3 Key 才走 api_key 查询参数。
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    else params.api_key = key;
    const url = new URL(`https://api.themoviedb.org/3/${endpoint}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        return NextResponse.json({ ...filterFallback(query), source: 'fallback' });
      }
      const json = (await res.json()) as { total_results?: number; results?: TmdbHit[] };
      const isTv = endpoint.endsWith('/tv');
      const items = (json.results || []).map((m, index) => toItem(m, isTv, index));
      return NextResponse.json({
        source: 'tmdb',
        total: json.total_results || items.length,
        page: query.page,
        items,
      });
    } catch {
      return NextResponse.json({ ...filterFallback(query), source: 'fallback' });
    }
  });
}

interface TmdbHit {
  id?: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}

function toItem(m: TmdbHit, isTv: boolean, index: number): CatalogItem {
  const rawDate = m.release_date || m.first_air_date || '';
  const [a, b] = PALETTE[(m.id || index) % PALETTE.length];
  return {
    id: m.id || index,
    t: m.title || m.name || '未知',
    y: rawDate ? Number(rawDate.slice(0, 4)) : 0,
    d: rawDate ? rawDate.slice(0, 7).replace('-', '.') : '',
    r: Math.round((m.vote_average || 0) * 10) / 10,
    a,
    b,
    ty: isTv ? '剧集' : '电影',
    poster: m.poster_path ? `/api/img/w500${m.poster_path}` : '',
    w: (m.overview || '').slice(0, 80),
  };
}
