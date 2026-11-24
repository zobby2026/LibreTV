import { guardRequest } from '@/lib/api-guard';
import { chatJson } from '@/lib/ai-openai';
import { catalog, flattenCatalog } from '@/lib/catalog';

export const runtime = 'nodejs';

interface Pick {
  t: string;
  y: number;
  w: string;
}

/**
 * GET /api/ai/curate?q=  SSE。
 * 只向模型要片名和理由。片源校验交给浏览器并发打现有 /api/search，
 * 避免一次请求里打爆 Workers 的 50 个子请求上限。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const q = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (!q) {
    return Response.json({ error: '请输入搜索内容' }, { status: 422 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send('step', { index: 0, label: '理解意图' });
        send('step', { index: 1, label: '提取情绪标签' });
        const pool = flattenCatalog().slice(0, 24).map((m) => `${m.t}（${m.y}）`).join('、');
        const ai = await chatJson(
          '你是私人 AI 影展策展人。根据用户的模糊描述、情绪或片名，从给定片单里优先挑选，不够再补真实存在的作品，一共 5 部。严格返回 JSON：{"intro":"2句克制导语，45字以内","tags":["标签"],"movies":[{"t":"标准中文片名","y":2023,"w":"一句理由，30字以内"}]}',
          `用户想看：${q}\n可参考片单：${pool}`
        ) as { intro?: string; tags?: string[]; movies?: Pick[] } | null;

        const movies = sanitizePicks(ai?.movies);
        const intro = (ai?.intro || fallbackIntro(q)).slice(0, 80);
        send('step', { index: 2, label: '匹配片库' });
        send('intro', { text: intro, tags: ai?.tags || [] });
        send('movies', { movies: movies.length ? movies : fallbackPicks(q) });
        send('done', { ok: true });
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : '策展失败' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function sanitizePicks(movies: Pick[] | undefined): Pick[] {
  if (!Array.isArray(movies)) return [];
  return movies
    .map((m) => ({
      t: String(m?.t || '').replace(/[《》]/g, '').trim(),
      y: Number(m?.y) || 0,
      w: String(m?.w || '').slice(0, 40),
    }))
    .filter((m) => m.t)
    .slice(0, 5);
}

function fallbackIntro(q: string): string {
  return `按「${q.slice(0, 18)}」从今日片单里挑了几部。模型未接通时，先用这份兜底片单。`;
}

function fallbackPicks(q: string): Pick[] {
  const all = flattenCatalog(catalog);
  const hit = all.filter((m) => q && (m.t.includes(q) || (m.w || '').includes(q) || (m.ai || '').includes(q)));
  const list = (hit.length ? hit : all).slice(0, 5);
  return list.map((m) => ({ t: m.t, y: m.y, w: m.ai || m.w }));
}
