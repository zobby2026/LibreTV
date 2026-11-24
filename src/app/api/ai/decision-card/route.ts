import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { chatJson } from '@/lib/ai-openai';
import { withEdgeCache } from '@/lib/edge-cache';
import { readStoredJson, writeStoredJson } from '@/lib/document-store';

export const runtime = 'nodejs';

const THIRTY_DAYS_SEC = 60 * 60 * 24 * 30;
const THIRTY_DAYS_MS = THIRTY_DAYS_SEC * 1000;

interface CardPayload {
  p: string;
  c: string;
  f: string[];
  recap: string;
}

interface StoredCard {
  card: CardPayload;
  createdAt: number;
}

const FALLBACK: CardPayload = {
  p: '氛围感与叙事节奏兼具的精选作品。',
  c: '暂无明显劝退点，建议亲自体验。',
  f: ['剧情控', '影迷向', '沉浸观影'],
  recap: '独立成篇，无需补前作，直接观看即可。',
};

function buildStorageKey(title: string, year: string): string {
  const cleanTitle = title.replace(/[《》\s/\\?%*:|"<>]+/g, '').toLowerCase();
  const cleanYear = year.replace(/[^\d]/g, '').slice(0, 4);
  const slug = cleanYear ? `${cleanTitle}_${cleanYear}` : cleanTitle;
  return `ai-cards/${slug.slice(0, 80)}.json`;
}

/**
 * POST /api/ai/decision-card — 30 秒决策卡。
 * 三层缓存防重复消耗 Token：
 * 1. 客户端 localStorage (30 天)
 * 2. Cloudflare 边缘 Cache API (30 天，零 KV 消耗)
 * 3. 服务端持久层 document-store（Cloudflare KV / Docker 磁盘，跨节点共享 30 天；仅真正 AI 成功生成时写一次）
 */
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

  const storageKey = buildStorageKey(title, year);
  const keyUrl = new URL(req.url);
  keyUrl.search = `?key=${encodeURIComponent(storageKey)}`;
  const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });

  return withEdgeCache(cacheKey, THIRTY_DAYS_SEC, async () => {
    // 1. 先查跨节点持久缓存，命中直接返回，0 Token 消耗
    try {
      const stored = await readStoredJson<StoredCard | null>(storageKey, null);
      if (stored?.card?.p && Date.now() - (stored.createdAt || 0) < THIRTY_DAYS_MS) {
        return NextResponse.json(stored.card, {
          headers: { 'Cache-Control': `public, max-age=${THIRTY_DAYS_SEC}` },
        });
      }
    } catch {
      /* 存储读取失败不阻断生成 */
    }

    // 2. 未命中再调大模型生成
    const prompt = `影片：《${title}》（${year}）。参考简介：${overview}。\n`
      + '请严格返回 JSON 对象，包含以下 4 个字段（全部无剧透、极简克制）：\n'
      + '- p: string（核心看点，35字以内）\n'
      + '- c: string（潜在劝退点，30字以内）\n'
      + '- f: string[]（适合人群标签，3个短词，每个4-6字）\n'
      + '- recap: string（若为续集/系列作，用50字内总结前作关键剧情；若为独立影片，填「独立成篇，无需补前作，直接观看即可。」）';

    const ai = await chatJson('你是专业、克制的电影策展人，只输出合法 JSON。', prompt).catch(() => null) as
      | { p?: string; c?: string; f?: string[]; recap?: string }
      | null;

    const isAiGenerated = Boolean(ai && ai.p);
    const card: CardPayload = isAiGenerated
      ? {
          p: String(ai!.p).slice(0, 50),
          c: String(ai!.c || FALLBACK.c).slice(0, 40),
          f: Array.isArray(ai!.f) ? ai!.f.map(String).slice(0, 3) : FALLBACK.f,
          recap: String(ai!.recap || FALLBACK.recap).slice(0, 80),
        }
      : { ...FALLBACK, p: overview ? overview.slice(0, 35) : FALLBACK.p };

    // 3. 仅 AI 真实生成的结果落入持久层（降级兜底文案不落盘，避免污染缓存）
    if (isAiGenerated) {
      await writeStoredJson(storageKey, { card, createdAt: Date.now() } satisfies StoredCard).catch(() => {});
    }

    return NextResponse.json(card, {
      headers: { 'Cache-Control': `public, max-age=${isAiGenerated ? THIRTY_DAYS_SEC : 300}` },
    });
  });
}
