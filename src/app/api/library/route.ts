import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { buildDiscover, filterFallback, parseLibraryQuery, type CatalogItem, type LibraryQuery } from '@/lib/catalog';
import { withEdgeCache } from '@/lib/edge-cache';
import { fetchUpstream } from '@/lib/fetch-utils';

export const runtime = 'nodejs';

const PALETTE = [
  ['#e86f51', '#2b130e'], ['#5ea8ff', '#0d1b2a'], ['#f4a261', '#2a1a0c'],
  ['#b28cff', '#1b112e'], ['#4ecdc4', '#0b2220'], ['#ff6b8b', '#2b0f18'],
  ['#ffd27a', '#29200b'], ['#7ae582', '#0d2412'], ['#ff8c42', '#2b1608'],
  ['#6ee7ff', '#0b2026'],
];

const DOUBAN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

interface DoubanSubject {
  id?: string;
  title?: string;
  cover?: string;
  rate?: string;
}

function mapDoubanParams(q: LibraryQuery): { type: 'movie' | 'tv'; tag: string; sort: string } {
  const isTv = q.type === '剧集' || q.type === '动画' || q.type === '综艺';
  const type = isTv ? 'tv' : 'movie';

  let tag = '热门';
  if (q.type === '动画') {
    tag = '日本动画';
  } else if (q.type === '综艺') {
    tag = '综艺';
  } else if (q.region === '大陆') {
    tag = isTv ? '国产剧' : '华语';
  } else if (q.region === '港台') {
    tag = isTv ? '港剧' : '华语';
  } else if (q.region === '欧美') {
    tag = isTv ? '美剧' : '欧美';
  } else if (q.region === '日韩') {
    tag = isTv ? '韩剧' : '韩国';
  } else if (q.sort === '评分') {
    tag = '豆瓣高分';
  } else if (q.sort === '最新') {
    tag = '最新';
  }

  const sort = q.sort === '评分' ? 'rank' : q.sort === '最新' ? 'time' : 'recommend';
  return { type, tag, sort };
}

async function fetchDoubanLibrary(q: LibraryQuery): Promise<{ total: number; items: CatalogItem[] } | null> {
  // 豆瓣 search_subjects 接口不支持精确年份筛选；用户明确选了具体年份时跳过，走 TMDB 或本地兜底
  if (q.year !== '全部') return null;

  const { type, tag, sort } = mapDoubanParams(q);
  const pageSize = 18;
  const pageStart = (q.page - 1) * pageSize;
  const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(tag)}&sort=${sort}&page_limit=${pageSize}&page_start=${pageStart}`;

  try {
    const res = await fetchUpstream(target, {
      timeoutMs: 6000,
      headers: {
        'User-Agent': DOUBAN_UA,
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { subjects?: DoubanSubject[] };
    const subjects = Array.isArray(data.subjects) ? data.subjects : [];
    if (subjects.length === 0) return null;

    const items: CatalogItem[] = subjects
      .filter((s) => s.title && s.cover)
      .map((s, index) => {
        const idNum = Number(s.id) || index;
        const [a, b] = PALETTE[idNum % PALETTE.length];
        const httpsCover = String(s.cover).replace(/^http:\/\//i, 'https://');
        return {
          id: `db_${s.id || index}`,
          t: String(s.title),
          y: 0,
          d: '',
          r: Number(s.rate) || 0,
          a,
          b,
          ty: type === 'tv' ? '剧集' : '电影',
          // 统一包装为 /api/img?url=...，前端 CinemaImg 会先直连豆瓣国内 CDN、失败回退反代
          poster: `/api/img?url=${encodeURIComponent(httpsCover)}`,
          w: '',
        };
      });

    return { total: Math.max(items.length + pageStart, 180), items };
  } catch {
    return null;
  }
}

/** GET /api/library — 优先国内豆瓣接口提速，失败或按年份筛选时回退 TMDB（w342），最终兜底内置片单；12 小时边缘缓存。 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const query = parseLibraryQuery(new URL(req.url));
  const cacheReq = new Request(req.url, { method: 'GET' });
  return withEdgeCache(cacheReq, 60 * 60 * 12, async () => {
    // 1. 优先豆瓣公开接口（国内数据新鲜且更快）
    const doubanHit = await fetchDoubanLibrary(query);
    if (doubanHit) {
      return NextResponse.json({
        source: 'douban',
        total: doubanHit.total,
        page: query.page,
        items: doubanHit.items,
      });
    }

    // 2. 回退 TMDB（支持年份精确筛选）
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      return NextResponse.json({ ...filterFallback(query), source: 'fallback' });
    }
    const { endpoint, params } = buildDiscover(query);
    const headers: Record<string, string> = { Accept: 'application/json' };
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
    poster: m.poster_path ? `/api/img/w342${m.poster_path}` : '',
    w: (m.overview || '').slice(0, 80),
  };
}
