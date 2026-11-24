import catalogJson from '../../public/data/catalog.json';

/** 影展片单条目。颜色 a/b 在同步时写好，前端不再用 canvas 取色。 */
export interface CatalogItem {
  id: number | string;
  t: string;
  y: number;
  d: string;
  r: number;
  a: string;
  b: string;
  ty: string;
  poster: string;
  backdrop?: string;
  w: string;
  ai?: string;
  kind?: string;
  rg?: string;
}

export interface CatalogBoard {
  id: string;
  name: string;
  sub: string;
  items: CatalogItem[];
}

export interface CatalogFile {
  updated_at?: string;
  source?: string;
  hero: CatalogItem[];
  boards: CatalogBoard[];
}

export const catalog = catalogJson as CatalogFile;

export interface LibraryQuery {
  type: string;
  region: string;
  year: string;
  sort: string;
  page: number;
}

const REGION_MAP: Record<string, string> = {
  大陆: 'CN',
  港台: 'HK|TW',
  欧美: 'US|GB|FR',
  日韩: 'JP|KR',
};

/** 把片库筛选翻成一次 TMDB discover 请求，避免多次子请求。 */
export function buildDiscover(q: LibraryQuery): { endpoint: string; params: Record<string, string> } {
  const isTv = q.type === '剧集' || q.type === '动画' || q.type === '综艺';
  const endpoint = isTv ? 'discover/tv' : 'discover/movie';
  const dateField = isTv ? 'first_air_date' : 'primary_release_date';
  const params: Record<string, string> = {
    language: 'zh-CN',
    page: String(q.page),
  };
  if (q.type === '动画') params.with_genres = '16';
  else if (q.type === '综艺') params.with_genres = '10764|10767';
  if (REGION_MAP[q.region]) params.with_origin_country = REGION_MAP[q.region];
  if (q.year === '2026' || q.year === '2025' || q.year === '2024') {
    params[`${dateField}.gte`] = `${q.year}-01-01`;
    params[`${dateField}.lte`] = `${q.year}-12-31`;
  } else if (q.year === '更早') {
    params[`${dateField}.lte`] = '2023-12-31';
  }
  if (q.sort === '评分') {
    params.sort_by = 'vote_average.desc';
    params['vote_count.gte'] = '50';
  } else if (q.sort === '最新') {
    params.sort_by = `${dateField}.desc`;
  } else {
    params.sort_by = 'popularity.desc';
  }
  return { endpoint, params };
}

export function flattenCatalog(file: CatalogFile = catalog): CatalogItem[] {
  const seen = new Set<string>();
  const out: CatalogItem[] = [];
  for (const item of [...file.hero, ...file.boards.flatMap((b) => b.items)]) {
    if (seen.has(item.t)) continue;
    seen.add(item.t);
    out.push(item);
  }
  return out;
}

/** 没有 TMDB key 时，用内置片单在本地筛一页，保证界面能预览。 */
export function filterFallback(q: LibraryQuery, file: CatalogFile = catalog) {
  let items = flattenCatalog(file);
  if (q.type === '电影') items = items.filter((i) => (i.kind || i.ty) === '电影');
  else if (q.type === '剧集') items = items.filter((i) => (i.kind || i.ty) === '剧集');
  else if (q.type === '动画') items = items.filter((i) => i.kind === '动画');
  else if (q.type === '综艺') items = items.filter((i) => i.kind === '综艺');
  if (q.region !== '全部') items = items.filter((i) => i.rg === q.region);
  if (q.year === '2026' || q.year === '2025' || q.year === '2024') {
    items = items.filter((i) => i.y === Number(q.year));
  } else if (q.year === '更早') {
    items = items.filter((i) => i.y > 0 && i.y <= 2023);
  }
  items = [...items].sort((a, b) => {
    if (q.sort === '评分') return b.r - a.r;
    if (q.sort === '最新') return b.y - a.y;
    return b.r - a.r;
  });
  const pageSize = 18;
  const start = (q.page - 1) * pageSize;
  return { total: items.length, page: q.page, items: items.slice(start, start + pageSize) };
}

export function parseLibraryQuery(url: URL): LibraryQuery {
  return {
    type: url.searchParams.get('type') || '全部',
    region: url.searchParams.get('region') || '全部',
    year: url.searchParams.get('year') || '全部',
    sort: url.searchParams.get('sort') || '热度',
    page: Math.max(1, Number(url.searchParams.get('page') || '1') || 1),
  };
}
