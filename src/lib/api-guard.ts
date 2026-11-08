import { NextResponse } from 'next/server';
import { sessionUserId } from './auth';
import { findUserById } from './user-store';
import type { PublicUser } from './user-types';

/**
 * API Route 共享守卫。
 *
 * 分两层，别混用：
 *
 * 1. `guardRequest(req)` —— 同步、只验签名，不读磁盘。绝大多数业务接口（搜索、详情、
 *    豆瓣、直播…）只需要「有有效会话」，用它即可，别为每个请求多加一次文件读。
 * 2. `guardUser(req, { admin })` —— 异步、要拿到「是谁」。涉及个人数据、用户管理、
 *    邀请码的接口必须用它：签名有效但用户已被删除时，同步版会把请求放进来。
 *
 * 注意：`guardRequest` 不再因为「没配 PASSWORD」返回 503。多用户版里 PASSWORD
 * 只用于首次引导出 admin，之后删掉它也不该让全站接口失效。
 */

/** 同步守卫：未登录返回 401 */
export function guardRequest(req: Request): NextResponse | null {
  if (!sessionUserId(req.headers.get('cookie'))) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  return null;
}

export type GuardResult =
  | { ok: true; user: PublicUser }
  | { ok: false; response: NextResponse };

/**
 * 异步守卫：解析出当前用户；`admin: true` 时额外要求管理员身份。
 * 用户被删除后旧会话立即失效（查不到人就当未登录）。
 */
export async function guardUser(
  req: Request,
  opts?: { admin?: boolean }
): Promise<GuardResult> {
  const userId = sessionUserId(req.headers.get('cookie'));
  if (!userId) return { ok: false, response: jsonError('未登录', 401) };
  const user = await findUserById(userId).catch(() => null);
  if (!user) return { ok: false, response: jsonError('登录状态已失效，请重新登录', 401) };
  if (opts?.admin && user.role !== 'admin') {
    return { ok: false, response: jsonError('需要管理员权限', 403) };
  }
  return { ok: true, user };
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
