import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 每日片单同步。零依赖，只用 Node 20 原生 fetch。
 * 没有 TMDB_API_KEY 时不覆盖已有 catalog.json，本地预览继续用内置兜底数据。
 * AI 导语优先用 AI_API_KEY（默认 DeepSeek）；没有则用 GITHUB_TOKEN 调 GitHub Models。
 * 失败时导语降级为简介，不让整次同步失败。
 */
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const AI_BASE_URL = (process.env.AI_BASE_URL || (GITHUB_TOKEN && !process.env.AI_API_KEY
  ? 'https://models.github.ai/inference'
  : 'https://api.deepseek.com/v1')).replace(/\/+$/, '');
const AI_API_KEY = process.env.AI_API_KEY || (AI_BASE_URL.includes('models.github.ai') ? GITHUB_TOKEN : '');
const AI_MODEL = process.env.AI_MODEL || (AI_BASE_URL.includes('models.github.ai') ? 'openai/gpt-4o-mini' : 'deepseek-chat');

const PALETTE = [
  ['#e86f51', '#2b130e'], ['#5ea8ff', '#0d1b2a'], ['#f4a261', '#2a1a0c'],
  ['#b28cff', '#1b112e'], ['#4ecdc4', '#0b2220'], ['#ff6b8b', '#2b0f18'],
  ['#ffd27a', '#29200b'], ['#7ae582', '#0d2412'], ['#ff8c42', '#2b1608'],
  ['#6ee7ff', '#0b2026'],
];

const outPath = path.resolve('public/data/catalog.json');

if (!TMDB_KEY) {
  console.warn('未配置 TMDB_API_KEY，保留现有 public/data/catalog.json');
  process.exit(0);
}

async function fetchTmdb(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `https://api.themoviedb.org/3/${endpoint}${sep}api_key=${TMDB_KEY}&language=zh-CN`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDB 请求失败: ${endpoint} (${res.status})`);
  return res.json();
}

function formatItem(item, index = 0) {
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
    poster: item.poster_path ? `/api/img/w500${item.poster_path}` : '',
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

async function main() {
  const [trending, netflix, western, china, jpk, anime, topRated] = await Promise.all([
    fetchTmdb('trending/all/day'),
    fetchTmdb('discover/tv?with_networks=213&sort_by=popularity.desc'),
    fetchTmdb('discover/movie?with_origin_country=US|GB&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_origin_country=CN&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_origin_country=JP|KR&sort_by=popularity.desc'),
    fetchTmdb('discover/tv?with_genres=16&sort_by=popularity.desc'),
    fetchTmdb('discover/movie?sort_by=vote_average.desc&vote_count.gte=500'),
  ]);

  const hero = (trending.results || []).slice(0, 10).map(formatItem);
  const aiIntros = await generateAiIntros(hero);
  hero.forEach((m) => {
    if (aiIntros[m.t]) m.ai = String(aiIntros[m.t]).slice(0, 40);
  });

  const payload = {
    updated_at: new Date().toISOString(),
    source: 'tmdb',
    hero,
    boards: [
      { id: 'netflix', name: 'Netflix 热榜', sub: '流媒体风向', items: (netflix.results || []).slice(0, 10).map(formatItem) },
      { id: 'western', name: '欧美榜', sub: '院线与高分', items: (western.results || []).slice(0, 10).map(formatItem) },
      { id: 'china', name: '国内榜', sub: '华语热播', items: (china.results || []).slice(0, 10).map(formatItem) },
      { id: 'jpk', name: '日韩榜', sub: '东亚精选', items: (jpk.results || []).slice(0, 10).map(formatItem) },
      { id: 'anime', name: '动画榜', sub: '二次元必看', items: (anime.results || []).slice(0, 10).map(formatItem) },
      { id: 'top', name: '高分总榜', sub: '影史口碑', items: (topRated.results || []).slice(0, 10).map(formatItem) },
    ],
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log('已成功更新 public/data/catalog.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
