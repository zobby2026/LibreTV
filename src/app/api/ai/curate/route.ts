import { guardRequest } from '@/lib/api-guard';
import { aiConfig, chatStreamLines } from '@/lib/ai-openai';
import { catalog, flattenCatalog } from '@/lib/catalog';
import {
  isValidHexColor,
  matchCuratePreset,
  type CuratePick,
  type CuratorNotes,
} from '@/lib/curate-presets';

export const runtime = 'nodejs';

interface CachedCurateResult {
  expiresAt: number;
  festivalTitle: string;
  subtitle: string;
  themeColor: string;
  tags: string[];
  movies: CuratePick[];
  notes: CuratorNotes;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 60;
const curateCache = new Map<string, CachedCurateResult>();

function getCached(key: string): CachedCurateResult | null {
  const hit = curateCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    curateCache.delete(key);
    return null;
  }
  return hit;
}

function setCached(key: string, value: Omit<CachedCurateResult, 'expiresAt'>): void {
  if (curateCache.size >= CACHE_MAX) {
    const oldest = curateCache.keys().next().value;
    if (oldest) curateCache.delete(oldest);
  }
  curateCache.set(key, { ...value, expiresAt: Date.now() + CACHE_TTL_MS });
}

const SYSTEM_PROMPT = [
  '你是私人 AI 影展策展人，文风克制、短句、有画面感。',
  '根据用户的模糊描述、情绪或片名，从参考片单优先挑选，不够再补真实存在的作品，一共 5 部。',
  '严格按 NDJSON 输出（每行一个合法 JSON 对象，禁止 Markdown 代码块、禁止多余说明），顺序固定：',
  '第1行：{"type":"meta","festivalTitle":"8到14字影展名，可用·分隔","subtitle":"14字以内副题","tags":["词1","词2","词3"],"themeColor":"#hex六位亮色"}',
  '第2到6行（共5行）：{"type":"movie","t":"标准中文片名","y":2023,"w":"一句推荐理由，24字以内","note":"展签批注，14字以内，如：适合一个人，开着小灯看完。"}',
  '第7行：{"type":"notes","preface":"策展词，28字以内","advice":"观看建议，24字以内","lineup":"今夜片单导语，26字以内"}',
].join('\n');

/**
 * GET /api/ai/curate?q=  SSE。
 * 1. 通过 OpenAI stream:true + NDJSON 首行到达即推送 meta/tags/themeColor，大幅降低感知延迟。
 * 2. 每解析出一部电影立刻推送 `movie` 事件，前端可立即并发校验 /api/search，无需等整包完成。
 * 3. 内置 5 分钟服务端缓存 + 预设策展文案兜底，确保无 Key 或超时也能稳定开幕。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const q = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (!q) {
    return Response.json({ error: '请输入搜索内容' }, { status: 422 });
  }

  const allCatalog = flattenCatalog(catalog);
  const totalCatalog = allCatalog.length || 128;
  const preset = matchCuratePreset(q);
  const cacheKey = q.toLowerCase();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        send('step', { index: 0, label: '理解意图', totalCatalog });

        const cached = getCached(cacheKey);
        if (cached) {
          send('meta', {
            festivalTitle: cached.festivalTitle,
            subtitle: cached.subtitle,
            themeColor: cached.themeColor,
            tags: cached.tags,
            totalCatalog,
          });
          send('step', { index: 1, label: '提取情绪标签', tags: cached.tags });
          send('step', { index: 2, label: '匹配片库', totalCatalog, count: cached.movies.length });
          cached.movies.forEach((m, i) => send('movie', { movie: m, index: i }));
          send('notes', cached.notes);
          send('intro', { text: cached.notes.preface, tags: cached.tags });
          send('movies', { movies: cached.movies });
          send('done', { ok: true, cached: true });
          return;
        }

        let metaSent = false;
        let matchStepSent = false;
        let festivalTitle = preset.festivalTitle;
        let subtitle = preset.subtitle;
        let themeColor = preset.themeColor;
        let tags = preset.tags;
        let notes: CuratorNotes = preset.notes;
        const movies: CuratePick[] = [];
        const seenTitles = new Set<string>();

        const emitMetaIfNeeded = () => {
          if (metaSent) return;
          metaSent = true;
          send('meta', { festivalTitle, subtitle, themeColor, tags, totalCatalog });
          send('step', { index: 1, label: '提取情绪标签', tags });
        };

        const emitMovie = (raw: Partial<CuratePick>) => {
          const cleanTitle = String(raw.t || '').replace(/[《》]/g, '').trim();
          if (!cleanTitle || seenTitles.has(cleanTitle) || movies.length >= 5) return;
          seenTitles.add(cleanTitle);
          const pick: CuratePick = {
            t: cleanTitle,
            y: Number(raw.y) || 0,
            w: String(raw.w || '').trim().slice(0, 36) || preset.annotations[movies.length % preset.annotations.length],
            note: String(raw.note || '').trim().slice(0, 22) || preset.annotations[movies.length % preset.annotations.length],
          };
          movies.push(pick);
          emitMetaIfNeeded();
          if (!matchStepSent) {
            matchStepSent = true;
            send('step', { index: 2, label: '匹配片库', totalCatalog });
          }
          send('movie', { movie: pick, index: movies.length - 1 });
        };

        const { enabled } = aiConfig();
        if (enabled) {
          const pool = allCatalog
            .slice(0, 24)
            .map((m) => `${m.t}(${m.y})`)
            .join('、');

          await chatStreamLines(
            SYSTEM_PROMPT,
            `用户心愿：${q}\n参考片单：${pool}`,
            {
              signal: req.signal,
              timeoutMs: 11000,
              maxTokens: 460,
              temperature: 0.65,
              onLine: (line) => {
                const parsed = parseLooseJsonLine(line);
                if (!parsed || typeof parsed !== 'object') return;
                const obj = parsed as Record<string, unknown>;
                const kind = String(obj.type || '');

                if (kind === 'meta' || (!kind && (obj.festivalTitle || obj.tags))) {
                  if (typeof obj.festivalTitle === 'string' && obj.festivalTitle.trim()) {
                    festivalTitle = obj.festivalTitle.trim().slice(0, 22);
                  }
                  if (typeof obj.subtitle === 'string' && obj.subtitle.trim()) {
                    subtitle = obj.subtitle.trim().slice(0, 24);
                  }
                  if (isValidHexColor(obj.themeColor)) {
                    themeColor = obj.themeColor.trim();
                  }
                  if (Array.isArray(obj.tags)) {
                    const cleanTags = obj.tags
                      .map((t) => String(t || '').trim().slice(0, 8))
                      .filter(Boolean)
                      .slice(0, 4);
                    if (cleanTags.length) tags = cleanTags;
                  }
                  emitMetaIfNeeded();
                  return;
                }

                if (kind === 'movie' || (!kind && typeof obj.t === 'string')) {
                  emitMovie({
                    t: String(obj.t || ''),
                    y: Number(obj.y) || 0,
                    w: typeof obj.w === 'string' ? obj.w : '',
                    note: typeof obj.note === 'string' ? obj.note : '',
                  });
                  return;
                }

                if (kind === 'notes' || (!kind && (obj.preface || obj.advice))) {
                  notes = {
                    preface: String(obj.preface || preset.notes.preface).trim().slice(0, 52),
                    advice: String(obj.advice || preset.notes.advice).trim().slice(0, 48),
                    lineup: String(obj.lineup || preset.notes.lineup).trim().slice(0, 52),
                  };
                  return;
                }

                // 兼容某些模型仍输出整包 JSON：{"intro":...,"movies":[...]}
                if (Array.isArray(obj.movies)) {
                  if (typeof obj.intro === 'string' && obj.intro.trim()) {
                    notes = { ...preset.notes, preface: obj.intro.trim().slice(0, 52) };
                  }
                  for (const item of obj.movies) {
                    if (item && typeof item === 'object') {
                      emitMovie(item as Partial<CuratePick>);
                    }
                  }
                }
              },
            }
          );
        }

        emitMetaIfNeeded();

        if (movies.length < 5) {
          const fallback = fallbackPicks(q, preset.annotations);
          for (const item of fallback) {
            if (movies.length >= 5) break;
            emitMovie(item);
          }
        }

        if (!matchStepSent) {
          send('step', { index: 2, label: '匹配片库', totalCatalog, count: movies.length });
        }

        send('notes', notes);
        send('intro', { text: notes.preface, tags });
        send('movies', { movies });

        if (movies.length > 0) {
          setCached(cacheKey, {
            festivalTitle,
            subtitle,
            themeColor,
            tags,
            movies,
            notes,
          });
        }

        send('done', { ok: true });
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : '策展失败' });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
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

function parseLooseJsonLine(line: string): unknown | null {
  const trimmed = line.replace(/^```(?:json|ndjson)?/i, '').replace(/```$/, '').trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function fallbackPicks(q: string, annotations: string[]): CuratePick[] {
  const all = flattenCatalog(catalog);
  const terms = q
    .split(/[\s，。、！？,./]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  const scored = all
    .map((m) => {
      const hay = `${m.t} ${m.w || ''} ${m.ai || ''}`;
      let score = 0;
      if (q && hay.includes(q)) score += 5;
      for (const term of terms) {
        if (hay.includes(term)) score += 2;
      }
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  const picked = scored.filter((x) => x.score > 0).map((x) => x.m);
  const list = (picked.length >= 5 ? picked : [...picked, ...all.filter((m) => !picked.includes(m))]).slice(0, 5);
  return list.map((m, idx) => ({
    t: m.t,
    y: m.y,
    w: (m.ai || m.w || '').slice(0, 36),
    note: annotations[idx % annotations.length],
  }));
}
