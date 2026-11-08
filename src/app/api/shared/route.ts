import { NextResponse } from 'next/server';
import { guardUser, jsonError } from '@/lib/api-guard';
import { getSharedConfig, saveSharedConfig } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * 共享配置（全员共用）：采集站、SourceList 订阅、直播源。
 *
 * GET 所有人可读——新用户第一次打开站点就拿管理员维护的这套源，不用自己拖源。
 * PUT 仅管理员可写，避免某个用户把全家的源改乱。
 *
 * 游客（未登录）不在这里取源，仍走 /api/status 里部署者预置的 DEFAULT_SOURCES。
 */
export async function GET(req: Request) {
  const gate = await guardUser(req);
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getSharedConfig());
}

export async function PUT(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;

  let body: { customAPIs?: unknown; subscriptions?: unknown; liveSubscriptions?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('请求格式错误', 400);
  }

  const arr = (v: unknown, field: string) => {
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) throw new Error(`${field} 必须是数组`);
    return v;
  };

  let patch;
  try {
    patch = {
      customAPIs: arr(body.customAPIs, 'customAPIs'),
      subscriptions: arr(body.subscriptions, 'subscriptions'),
      liveSubscriptions: arr(body.liveSubscriptions, 'liveSubscriptions'),
    };
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : '参数错误', 400);
  }

  try {
    const next = await saveSharedConfig(patch, gate.user.username);
    return NextResponse.json(next);
  } catch (err) {
    console.error('[zobby] 保存共享配置失败', err);
    return jsonError('保存失败：服务端数据目录不可写', 500);
  }
}
