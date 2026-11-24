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
 * 每日片单与热点策展同步。零依赖，只用 Node 20 原生 fetch。
 * 1. 优先走豆瓣移动端实时热榜（串行 500ms 间隔防风控），若配有 TMDB_API_KEY 则补齐高清横版剧照（w780）；
 *    豆瓣风控失败时自动回退 TMDB 榜单兜底。
 * 2. 顺手抓取豆瓣热议与 60s 免费热榜（微博/知乎/B站），由 AI 一次性生成：
 *    - 3 张每日热点「AI 策展笔记」（editorials）
 *    - 2~3 张「今日热点心情卡」（moods）
 *    写入 public/data/catalog.json，用户访问 0 延迟、0 实时 Token。
 */
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || (GITHUB_TOKEN && !process.env.AI_API_KEY
  ? 'https://models.github.ai/inference'
  : 'https://api.deepseek.com/v1')).replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || (AI_BASE_URL.includes('models.github.ai') ? GITHUB_TOKEN : '');
const AI_MODEL = process.env.AI_MODEL || (AI_BASE_URL.includes('models.github.ai') ? 'openai/gpt-4o-mini' : 'deepseek-chat');
const SIXTY_BASE = (process.env['60S_API_BASE'] || 'https://60s.crystelf.top').replace(/\/+$/, '');
const SIXTY_FALLBACK = 'https://60s.viki.moe';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const PALETTE = [
  ['#e86f51', '#2b130e'], ['#5ea8ff', '#0d1b2a'], ['#f4a261', '#2a1a0c'],
  ['#b28cff', '#1b112e'], ['#4ecdc4', '#0b2220'], ['#ff6b8b', '#2b0f18'],
  ['#ffd27a', '#29200b'], ['#7ae582', '#0d2412'], ['#ff8c42', '#2b1608'],
  ['#6ee7ff', '#0b2026'],
];

const MOOD_BG_POOL = [
  'linear-gradient(135deg,#3b1d2a,#140a10)',
  'linear-gradient(135deg,#1d2d44,#0b1320)',
  'linear-gradient(135deg,#2e1f47,#120d1d)',
  'linear-gradient(135deg,#163832,#071916)',
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

/** 从 60s 免费热榜（微博/知乎/B站）与豆瓣书影音话题抓取当天全网热议关键词 */
async function fetchDailyHotTopics(hero) {
  const topics = [];
  const bases = SIXTY_BASE === SIXTY_FALLBACK ? [SIXTY_BASE] : [SIXTY_BASE, SIXTY_FALLBACK];

  const fetch60s = async (endpoint) => {
    for (const base of bases) {
      try {
        const res = await fetch(`${base}${endpoint}`, {
          headers: { 'User-Agent': 'LibreTV-Sync/1.0', Accept: 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (Array.isArray(json?.data)) return json.data;
      } catch {
        /* 尝试下一个实例 */
      }
    }
    return [];
  };

  // 1. 豆瓣当日热映/热播影片本身就是最精准的影视话题
  hero.slice(0, 6).forEach((m) => topics.push(`豆瓣热议影视：${m.t}`));

  // 2. 并行拉取 60s 微博 / 知乎 / B站热榜（各取前 8 条）
  const [weibo, zhihu, bili] = await Promise.all([
    fetch60s('/v2/weibo'),
    fetch60s('/v2/zhihu'),
    fetch60s('/v2/bili'),
  ]);
  for (const row of weibo.slice(0, 8)) {
    const title = row?.title || row?.word || row?.name;
    if (title) topics.push(`微博热搜：${String(title).slice(0, 28)}`);
  }
  for (const row of zhihu.slice(0, 8)) {
    const title = row?.title || row?.name;
    if (title) topics.push(`知乎热榜：${String(title).slice(0, 28)}`);
  }
  for (const row of bili.slice(0, 8)) {
    const title = row?.title || row?.name;
    if (title) topics.push(`B站热门：${String(title).slice(0, 28)}`);
  }

  return topics.slice(0, 28);
}

function buildFallbackDailyCuration(hero) {
  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayLabel = weekdays[now.getDay()];
  const topTitle = hero[0]?.t || '高分悬疑';
  const secondTitle = hero[1]?.t || '治愈系电影';

  const editorials = [
    {
      id: 'ed_hot_1',
      badge: '🔥 豆瓣今日热议',
      title: `都在聊《${topTitle}》？这 3 部同气质佳作更上头`,
      sub: '顺着今日热榜挖同款氛围',
      query: `像《${topTitle}》一样口碑出圈、剧情紧凑、值得一口气刷完的高分影视`,
      accent: hero[0]?.a || '#e86f51',
    },
    {
      id: 'ed_mood_2',
      badge: `🌙 ${dayLabel}放映指南`,
      title: `${dayLabel}晚上的电子布洛芬：3 部看完心情变轻的片`,
      sub: '零压力下饭与情绪充电',
      query: `适合${dayLabel}晚上放松解压、节奏轻快、画面治愈的高分电影或剧集`,
      accent: '#5ea8ff',
    },
    {
      id: 'ed_gem_3',
      badge: '🎞️ 策展人私藏',
      title: `除了《${secondTitle}》，这 3 部冷门高分片后劲极大`,
      sub: '评分 8.2+ 却少有人推',
      query: '豆瓣8.2分以上冷门小众、摄影高级、看完后劲极大的私藏佳片',
      accent: '#b28cff',
    },
  ];

  const moods = [
    {
      emoji: '🔥',
      label: '今日热议',
      sub: `同款《${topTitle.slice(0, 6)}》`,
      query: `类似《${topTitle}》的近期热门高分影视`,
      bg: MOOD_BG_POOL[0],
      hot: true,
      slot: 'any',
    },
    {
      emoji: '🎬',
      label: `${dayLabel}片单`,
      sub: '今日专属氛围',
      query: `适合${dayLabel}看的氛围感强、口碑在线的电影`,
      bg: MOOD_BG_POOL[1],
      hot: true,
      slot: 'any',
    },
  ];

  return { editorials, moods };
}

/** 每日一次性调用 AI 生成 3 张热点「AI 策展笔记」与 2~3 张「今日热点心情卡」 */
async function generateDailyCuration(hero, hotTopics) {
  const fallback = buildFallbackDailyCuration(hero);
  if (!AI_API_KEY) return fallback;

  const now = new Date();
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${weekdays[now.getDay()]}`;

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
            content:
              '你是极简暗黑风格的私人电影策展人。结合今日日期、豆瓣热议影视与全网热搜话题，策划：\n'
              + '1. editorials：严格 3 张首页策展笔记（1张结合今日热点/豆瓣热议，1张结合今日星期/社会情绪，1张小众高分挖宝）。\n'
              + '2. moods：2 张带大号单个 Emoji 的「今日热点心情卡」。\n'
              + '严格返回 JSON：{"editorials":[{"badge":"🔥 豆瓣今日热议","title":"18字以内吸睛标题","sub":"10字以内副标题","query":"给AI找片用的精准中文搜索描述"}],"moods":[{"emoji":"🔥","label":"4-5字情绪名","sub":"5-7字副标","query":"给AI找片用的精准中文搜索描述"}]}',
          },
          {
            role: 'user',
            content: `今天是：${dateStr}\n今日热议与热榜参考：\n${hotTopics.join('\n')}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI ${res.status}`);
    const data = await res.json();
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');

    const rawEd = Array.isArray(parsed.editorials) ? parsed.editorials : [];
    const editorials = rawEd
      .filter((e) => e?.title && e?.query)
      .slice(0, 3)
      .map((e, i) => ({
        id: `ed_daily_${i + 1}`,
        badge: String(e.badge || '✦ 今日策展').slice(0, 14),
        title: String(e.title).slice(0, 26),
        sub: String(e.sub || '点击查看精选片单').slice(0, 18),
        query: String(e.query).slice(0, 80),
        accent: PALETTE[(i * 3) % PALETTE.length][0],
      }));

    const rawMoods = Array.isArray(parsed.moods) ? parsed.moods : [];
    const moods = rawMoods
      .filter((m) => m?.emoji && m?.label)
      .slice(0, 3)
      .map((m, i) => ({
        emoji: String(m.emoji).slice(0, 4),
        label: String(m.label).slice(0, 8),
        sub: String(m.sub || '今日热门情绪').slice(0, 10),
        query: String(m.query || m.label).slice(0, 80),
        bg: MOOD_BG_POOL[i % MOOD_BG_POOL.length],
        hot: true,
        slot: 'any',
      }));

    return {
      editorials: editorials.length === 3 ? editorials : fallback.editorials,
      moods: moods.length >= 2 ? moods : fallback.moods,
    };
  } catch (err) {
    console.warn('每日热点策展生成失败，使用兜底策展:', err instanceof Error ? err.message : err);
    return fallback;
  }
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

  const [aiIntros, hotTopics] = await Promise.all([
    generateAiIntros(result.hero),
    fetchDailyHotTopics(result.hero),
  ]);
  result.hero.forEach((m) => {
    if (aiIntros[m.t]) m.ai = String(aiIntros[m.t]).slice(0, 40);
  });

  const daily = await generateDailyCuration(result.hero, hotTopics);

  const payload = {
    updated_at: new Date().toISOString(),
    source: result.source,
    hero: result.hero,
    boards: result.boards,
    editorials: daily.editorials,
    moods: daily.moods,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`已成功更新 public/data/catalog.json（来源：${result.source}，策展笔记 ${daily.editorials.length} 张，热点心情 ${daily.moods.length} 张）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
