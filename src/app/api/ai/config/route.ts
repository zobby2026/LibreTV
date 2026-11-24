import { NextResponse } from 'next/server';
import { guardUser } from '@/lib/api-guard';
import { getEffectiveAiConfig } from '@/lib/ai-openai';
import { saveSharedConfig } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * GET /api/ai/config — 查询当前 AI 状态（仅管理员）。
 */
export async function GET(req: Request) {
  const guard = await guardUser(req, { admin: true });
  if (!guard.ok) return guard.response;

  const current = await getEffectiveAiConfig();
  const rawKey = current.key || '';
  const maskedKey = rawKey.length > 8
    ? `${rawKey.slice(0, 3)}****${rawKey.slice(-4)}`
    : rawKey ? '****' : '';

  return NextResponse.json({
    enabled: current.enabled,
    source: current.source,
    baseUrl: current.base,
    model: current.model,
    maskedKey,
  });
}

/**
 * POST /api/ai/config — 配置或测试 AI Key（仅管理员）。
 * 请求体：{ apiKey?: string; baseUrl?: string; model?: string; testOnly?: boolean }
 */
export async function POST(req: Request) {
  const guard = await guardUser(req, { admin: true });
  if (!guard.ok) return guard.response;

  let body: { apiKey?: string; baseUrl?: string; model?: string; testOnly?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: '请求数据格式错误' }, { status: 400 });
  }

  const rawKey = String(body.apiKey || '').trim();
  const rawBase = String(body.baseUrl || '').trim() || 'https://api.deepseek.com/v1';
  const cleanBase = rawBase.replace(/\/+$/, '');
  const rawModel = String(body.model || '').trim() || (cleanBase.includes('models.github.ai') ? 'openai/gpt-4o-mini' : 'deepseek-chat');

  if (body.testOnly || rawKey) {
    // 连通性测试
    const keyToTest = rawKey || (await getEffectiveAiConfig()).key;
    if (!keyToTest) {
      return NextResponse.json({ error: '请先填写 API Key' }, { status: 422 });
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      const res = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keyToTest}`,
        },
        body: JSON.stringify({
          model: rawModel,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return NextResponse.json(
          { error: `连接测试失败 (${res.status}): ${text.slice(0, 100) || '鉴权失败或模型不可用'}` },
          { status: 400 }
        );
      }
    } catch (err) {
      return NextResponse.json(
        { error: `连接超时或网络异常: ${err instanceof Error ? err.message : '无法访问接口'}` },
        { status: 504 }
      );
    }

    if (body.testOnly) {
      return NextResponse.json({ ok: true, message: '连通性测试通过！大模型响应正常。' });
    }
  }

  // 保存到 KV 共享配置
  await saveSharedConfig(
    {
      aiConfig: {
        apiKey: rawKey,
        baseUrl: cleanBase,
        model: rawModel,
      },
    },
    guard.user.id
  );

  return NextResponse.json({
    ok: true,
    message: rawKey ? 'AI 大模型已成功接入并保存！' : '已清空自定义 AI Key（恢复为环境变量）',
  });
}
