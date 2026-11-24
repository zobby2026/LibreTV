import fs from 'node:fs/promises';
import path from 'node:path';

/** 本地 .env 只给这个脚本用，不打印内容。GitHub Actions 仍走环境变量。 */
try {
  const envFile = await fs.readFile(path.resolve('.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (name && process.env[name] === undefined) process.env[name] = value;
  }
} catch {
  /* 没有 .env 时用进程环境 */
}

/**
 * 每日片单同步。零依赖，只用 Node 20 原生 fetch。
 * 优先走豆瓣移动端实时热榜（串行 500ms 间隔防风控），拿到片名后若配有 TMDB_API_KEY
 * 则顺手补齐高清横版剧照（w780）；若豆瓣临时风控失败，自动回退到 TMDB 榜单兜底。
 */
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || (GITHUB_TOKEN && !process.env.AI_API_KEY
  ? 'https://models.github.ai/inference'
  : 'https://api.deepseek.com/v1')).replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || (AI_BASE_URL.includes('models.github.ai') ? GITHUB_TOKEN : '');
const AI_MODEL = process.env.AI_MODEL || (AI_BASE_URL.includes('models.github.ai') ? 'openai/gpt-4o-mini' : 'deepseek-chat');

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const PALETTE = [
  ['#e86f51', '#2b130e'], ['#5ea8ff', '#0d1b2a'], ['#f4a261', '#2a1a0c'],
  ['#b28cff', '#1b112e'], ['#4ecdc4', '#0b2220'], ['#ff6b8b', '#2b0f18'],
  ['#ffd27a', '#29200b'], ['#7ae582', '#0d2412'], ['#ff8c42', '#2b1608'],
  ['#6ee7ff', '#0b2026'],
];

const DOUBAN_BOARDS = [
  { id: 'hot_movie', collection: 'movie_showing', name: '热门电影', sub: '豆瓣实时热映', ty: '电影', kind: '电影' },
  { id: 'hot_tv', collection: 'tv_hot', name: '热门剧集', sub: '豆瓣实时热播', ty: '剧集', kind: '剧集' },
  { id: 'china', collection: 'tv_domestic', name: '华语热播', sub: '国产剧风向', ty: '剧集', kind: '剧集', rg: '大陆' },
  { id: 'jpk', collection: 'tv_korean', name: '日韩剧', sub: '东亚精选热播', ty: '剧集', kind: '剧集', rg: '日韩' },
  { id: 'anime', collection: 'tv_animation', name: '动画榜', sub: '高分新番热播', ty: '剧集', kind: '动画' },
  { id: 'weekly', collection: 'movie_weekly_best', name: '一周口碑榜', sub: '豆瓣每周精选', ty: '电影', kind: '电影' },
];

const outPath = path.resolve('public/data/catalog.json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashIndex(seed, fallback = 0) {
  const s = String(seed ?? fallback);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
}

function toDoubanImgProxy(url) {
  if (!url) return '';
  return `/api/img?url=${encodeURIComponent(url.replace(/^http:\/\//i, 'https://'))}`;
}

async function fetchDoubanCollection(collection, count = 12) {
  const url = `https://m.douban.com/rexxar/api/v2/subject_collection/${collection}/items?start=0&count=${count}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': MOBILE_UA,
      Referer: 'https://m.douban.com/',
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`豆瓣榜单请求失败: ${collection} (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.subject_collection_items) ? data.subject_collection_items : [];
}

function formatDoubanItem(raw, meta, index) {
  const [a, b] = PALETTE[hashIndex(raw.id || raw.title, index)];
  const year = Number(raw.year) || Number(String(raw.card_subtitle || '').match(/(19|20)\d{2}/)?.[0]) || 0;
  const coverUrl = raw.pic?.normal || raw.pic?.large || raw.cover?.url || '';
  const rating = Number((raw.rating?.value || 0).toFixed(1));
  const subtitle = String(raw.card_subtitle || raw.info || '').trim();
  const isTv = raw.type === 'tv' || meta.ty === '剧集';
  return {
    id: `db_${raw.id || index}`,
    t: String(raw.title || '未知片名').trim(),
    y: year,
    d: year ? `${year}` : '',
    r: rating,
    a,
    b,
    ty: isTv ? '剧集' : '电影',
    kind: meta.kind || (isTv ? '剧集' : '电影'),
    rg: meta.rg,
    poster: toDoubanImgProxy(coverUrl),
    backdrop: '',
    w: (raw.recommend_comment || subtitle || '暂无简介').slice(0, 80),
  };
}

async function fetchTmdb(endpoint) {
  if (!TMDB_KEY) throw new Error('未配置 TMDB_API_KEY');
  const sep = endpoint.includes('?') ? '&' : '?';
  const bearer = TMDB_KEY.startsWith('eyJ');
  const auth = bearer ? '' : `${sep}api_key=${encodeURIComponent(TMDB_KEY)}`;
  const joiner = bearer ? sep : (auth ? '&' : sep);
  const url = `https://api.themoviedb.org/3/${endpoint}${auth}${joiner}language=zh-CN`;
  const res = await fetch(url, {
    headers: bearer ? { Authorization: `Bearer ${TMDB_KEY}`, Accept: 'application/json' } : { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`TMDB 请求失败: ${endpoint} (${res.status})`);
  return res.json();
}

async function enrichWithTmdbBackdrop(item) {
  if (!TMDB_KEY || !item?.t) return item;
  try {
    const q = `search/multi?query=${encodeURIComponent(item.t)}&include_adult=false`;
    const data = await fetchTmdb(q);
    const hit = (data.results || []).find((r) => r.backdrop_path || r.poster_path);
    if (!hit) return item;
    return {
      ...item,
      backdrop: hit.backdrop_path ? `/api/img/w780${hit.backdrop_path}` : item.backdrop,
      poster: item.poster || (hit.poster_path ? `/api/img/w342${hit.poster_path}` : ''),
      w: item.w && item.w !== '暂无简介' ? item.w : String(hit.overview || '暂无简介').slice(0, 80),
    };
  } catch {
    return item;
  }
}

function formatTmdbItem(item, index = 0, posterSize = 'w342') {
  const rawDate = item.release_date || item.first_air_date || '';
  const [a, b] = PALETTE[(item.id || index) % PALETTE.length];
  const isTv = item.media_type === 'tv' || Boolean(item.first_air_date && !item.release_date);
  return {
    id: item.id,
    t: item.title || item.name || '未知片名',
    y: Number(rawDate.slice(0, 4)) || 0,
    d: rawDate ? rawDate.slice(0, 7).replace('-', '.') : '',
    r: Number((item.vote_average || 0).toFixed(1)),
    a,
    b,
    ty: isTv ? '剧集' : '电影',
    poster: item.poster_path ? `/api/img/${posterSize}${item.poster_path}` : '',
    backdrop: item.backdrop_path ? `/api/img/w780${item.backdrop_path}` : '',
    w: (item.overview || '暂无简介').slice(0, 80),
  };
}

async function generateAiIntros(movies) {
  if (!AI_API_KEY) return {};
  const listText = movies.map((m, i) => `${i + 1}. ${m.t} (${m.y})`).join('\n');
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是极简暗黑风格的私人电影策展人。为每部电影写一句20字以内的克制、有氛围感的推荐导语。严格返回 JSON 对象，key 为片名，value 为导语。',
          },
          { role: 'user', content: listText },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } catch (err) {
    console.warn('AI 导语生成失败，降级使用简介:', err instanceof Error ? err.message : err);
    return {};
  }
}

async function buildFromDouban() {
  const boards = [];
  for (let i = 0; i < DOUBAN_BOARDS.length; i += 1) {
    const spec = DOUBAN_BOARDS[i];
    if (i > 0) await sleep(500);
    const rawItems = await fetchDoubanCollection(spec.collection, 12);
    const items = rawItems.slice(0, 10).map((raw, idx) => formatDoubanItem(raw, spec, idx));
    if (items.length > 0) {
      boards.push({ id: spec.id, name: spec.name, sub: spec.sub, items });
    }
  }
  if (boards.length < 3) {
    throw new Error(`豆瓣有效榜单不足（仅拿到 ${boards.length} 个），切换 TMDB 兜底`);
  }

  // Hero 轮播：从「热门电影」和「一周口碑榜」去重取前 10 部，并补齐 TMDB 横版剧照（w780）
  const seen = new Set();
  const heroPool = [];
  const primaryBoards = [
    boards.find((b) => b.id === 'hot_movie'),
    boards.find((b) => b.id === 'weekly'),
    boards.find((b) => b.id === 'hot_tv'),
  ].filter(Boolean);
  for (const b of primaryBoards) {
    for (const item of b.items) {
      if (seen.has(item.t)) continue;
      seen.add(item.t);
      heroPool.push(item);
      if (heroPool.length >= 10) break;
    }
    if (heroPool.length >= 10) break;
  }

  const hero = [];
  for (let i = 0; i < heroPool.length; i += 1) {
    if (i > 0 && TMDB_KEY) await sleep(200);
    hero.push(await enrichWithTmdbBackdrop(heroPool[i]));
  }

  return { source: 'douban', hero, boards };
}

async function buildFromTmdb() {
  const [trending, netflix, western, china, jpk, anime, topRated] = await Promise.all([
    fetchTmdb('trending/all/day'),
    fetchTmdb('discover/tv?with_networks=213&sort_by=popularity.desc'),
    fetchTmdb('discover/movie?with_origin_country=US|GB&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_origin_country=CN&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_origin_country=JP|KR&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_genres=16&sort_by=popularity.desc'),
    fetchTmdb('discover/movie?sort_by=vote_average.desc&vote_count.gte=500'),
  ]);

  const hero = (trending.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w500'));
  const boards = [
    { id: 'netflix', name: 'Netflix 热榜', sub: '流媒体风向', items: (netflix.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
    { id: 'western', name: '欧美榜', sub: '院线与高分', items: (western.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
    { id: 'china', name: '国内榜', sub: '华语热播', items: (china.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
    { id: 'jpk', name: '日韩榜', sub: '东亚精选', items: (jpk.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
    { id: 'anime', name: '动画榜', sub: '二次元必看', items: (anime.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
    { id: 'top', name: '高分总榜', sub: '影史口碑', items: (topRated.results || []).slice(0, 10).map((m, i) => formatTmdbItem(m, i, 'w342')) },
  ];
  return { source: 'tmdb', hero, boards };
}

async function main() {
  let result;
  try {
    result = await buildFromDouban();
    console.log('已从豆瓣实时热榜获取片单');
  } catch (err) {
    console.warn('豆瓣热榜拉取失败，尝试回退 TMDB:', err instanceof Error ? err.message : err);
    if (!TMDB_KEY) {
      console.warn('未配置 TMDB_API_KEY，保留现有 public/data/catalog.json');
      process.exit(0);
    }
    result = await buildFromTmdb();
    console.log('已回退使用 TMDB 榜单');
  }

  const aiIntros = await generateAiIntros(result.hero);
  result.hero.forEach((m) => {
    if (aiIntros[m.t]) m.ai = String(aiIntros[m.t]).slice(0, 40);
  });

  const payload = {
    updated_at: new Date().toISOString(),
    source: result.source,
    hero: result.hero,
    boards: result.boards,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`已成功更新 public/data/catalog.json（来源：${result.source}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
