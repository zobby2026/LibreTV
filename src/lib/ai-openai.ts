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
