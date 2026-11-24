import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { chatJson } from '@/lib/ai-openai';
import { withEdgeCache } from '@/lib/edge-cache';

export const runtime = 'nodejs';

const FALLBACK = {
  p: '氛围感与叙事节奏兼具的精选作品。',
  c: '暂无明显劝退点，建议亲自体验。',
  f: ['剧情控', '影迷向', '沉浸观影'],
  recap: '独立成篇，无需补前作，直接观看即可。',
};

/** POST /api/ai/decision-card — 30 秒决策卡，按片名缓存 30 天，不写 KV。 */
export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let title = '';
  let year = '';
  let overview = '';
  try {
    const body = (await req.json()) as { title?: string; year?: string | number; overview?: string };
    title = String(body.title || '').trim();
    year = String(body.year || '').trim();
    overview = String(body.overview || '').trim().slice(0, 200);
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  if (!title) return NextResponse.json({ error: '缺少片名' }, { status: 422 });

  const keyUrl = new URL(req.url);
  keyUrl.search = `?title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`;
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });

  return withEdgeCache(cacheKey, 60 * 60 * 24 * 30, async () => {
    const prompt = `影片：《${title}》（${year}）。参考简介：${overview}。\n`
      + '请严格返回 JSON 对象，包含以下 4 个字段（全部无剧透、极简克制）：\n'
      + '- p: string（核心看点，35字以内）\n'
      + '- c: string（潜在劝退点，30字以内）\n'
      + '- f: string[]（适合人群标签，3个短词，每个4-6字）\n'
      + '- recap: string（若为续集/系列作，用50字内总结前作关键剧情；若为独立影片，填「独立成篇，无需补前作，直接观看即可。」）';
    const ai = await chatJson('你是专业、克制的电影策展人，只输出合法 JSON。', prompt).catch(() => null) as
      | { p?: string; c?: string; f?: string[]; recap?: string }
      | null;
    const card = ai && ai.p
      ? {
          p: String(ai.p).slice(0, 50),
          c: String(ai.c || FALLBACK.c).slice(0, 40),
          f: Array.isArray(ai.f) ? ai.f.map(String).slice(0, 3) : FALLBACK.f,
          recap: String(ai.recap || FALLBACK.recap).slice(0, 80),
        }
      : { ...FALLBACK, p: overview ? overview.slice(0, 35) : FALLBACK.p };
    return NextResponse.json(card);
  });
}
