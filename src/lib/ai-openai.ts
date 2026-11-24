/** OpenAI 兼容聊天。默认 DeepSeek；设成 GitHub Models 地址时同样可用。 */
export function aiConfig() {
  const base = (process.env.AI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const key = process.env.AI_API_KEY || '';
  const model = process.env.AI_MODEL || (base.includes('models.github.ai') ? 'openai/gpt-4o-mini' : 'deepseek-chat');
  return { base, key, model, enabled: Boolean(key) };
}

export async function chatJson(system: string, user: string): Promise<unknown | null> {
  const { base, key, model, enabled } = aiConfig();
  if (!enabled) return null;
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content || '';
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface ChatStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  onLine: (line: string) => void;
}

/**
 * 流式调用 OpenAI 兼容接口并按行回调（用于 NDJSON 渐进式输出）。
 * 相比整包等待 chatJson，首行到达即可驱动前端场景切换与片源并发校验。
 */
export async function chatStreamLines(
  system: string,
  user: string,
  options: ChatStreamOptions
): Promise<boolean> {
  const { base, key, model, enabled } = aiConfig();
  if (!enabled) return false;

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 12000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: options.maxTokens ?? 480,
        temperature: options.temperature ?? 0.65,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });

    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let contentBuf = '';
    let emittedAny = false;

    const flushLines = (final = false) => {
      let nlIdx = contentBuf.indexOf('\n');
      while (nlIdx >= 0) {
        const line = contentBuf.slice(0, nlIdx).trim();
        contentBuf = contentBuf.slice(nlIdx + 1);
        if (line) {
          emittedAny = true;
          options.onLine(line);
        }
        nlIdx = contentBuf.indexOf('\n');
      }
      if (final) {
        const tail = contentBuf.trim();
        contentBuf = '';
        if (tail) {
          emittedAny = true;
          options.onLine(tail);
        }
      }
    };

    const handleSseBlock = (block: string) => {
      for (const rawLine of block.split('\n')) {
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const piece = parsed.choices?.[0]?.delta?.content;
          if (piece) {
            contentBuf += piece;
            flushLines(false);
          }
        } catch {
          /* 忽略非 JSON 心跳分片 */
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      const blocks = sseBuf.split('\n\n');
      sseBuf = blocks.pop() || '';
      blocks.forEach(handleSseBlock);
    }
    if (sseBuf.trim()) handleSseBlock(sseBuf);
    flushLines(true);
    return emittedAny;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}
