import { NextResponse } from 'next/server';
import {
  applySessionCookie,
  clearRateLimit,
  clearSessionCookie,
  checkRateLimit,
  clientIp,
  sessionUserId,
} from '@/lib/auth';
import { authenticate, countUsers, findUserById, getSoleUsername } from '@/lib/user-store';
import type { AuthUserResponse } from '@/lib/user-types';

export const runtime = 'nodejs';

/**
 * 会话接口。
 *
 * - GET    查询当前登录用户（客户端据此渲染页头、决定是否弹登录框）
 * - POST   登录：{ username, password }；只有一个用户时 username 可省略（兼容旧版「只输密码」）
 * - DELETE 登出
 *
 * 注册走 /api/auth/register（需要一次性邀请码）。
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: '尝试次数过多，请 10 分钟后再试' },
      { status: 429 }
    );
  }

  let username = '';
  let password = '';
  try {
    const body = (await req.json()) as { username?: string; password?: string };
    username = String(body.username ?? '').trim();
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ success: false, error: '请输入密码' }, { status: 400 });
  }

  let userCount = 0;
  try {
    userCount = await countUsers();
  } catch (err) {
    console.error('[zobby] 读取用户存储失败', err);
    return NextResponse.json(
      { success: false, error: '服务端数据目录不可写，请检查 data 目录权限' },
      { status: 500 }
    );
  }

  if (userCount === 0) {
    return NextResponse.json(
      {
        success: false,
        error: '服务端还没有任何账号。请设置 PASSWORD 环境变量后重启，系统会自动创建 admin 账号。',
        setupRequired: true,
      },
      { status: 503 }
    );
  }

  // 只有一个账号时允许不填用户名：老用户升级到多用户版后，仍然只需输入原来的那个密码。
  // 这里取的是那个账号真实的用户名，不是硬编码的 admin。
  if (!username) {
    if (userCount === 1) {
      username = (await getSoleUsername()) ?? 'admin';
    } else {
      return NextResponse.json({ success: false, error: '请输入用户名' }, { status: 400 });
    }
  }

  const user = await authenticate(username, password);
  if (!user) {
    return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
  }

  clearRateLimit(ip);
  const res = NextResponse.json({ success: true, user });
  return applySessionCookie(res, req, user.id);
}

/** GET：当前会话对应的用户 */
export async function GET(req: Request) {
  const userId = sessionUserId(req.headers.get('cookie'));
  let userCount = 0;
  try {
    userCount = await countUsers();
  } catch {
    // 数据目录不可读时不阻塞页面渲染，交给登录/注册接口报具体错误
  }
  const user = userId ? await findUserById(userId).catch(() => null) : null;
  const payload: AuthUserResponse = {
    authenticated: Boolean(user),
    user,
    userCount,
    // 只有一个账号：客户端登录框预填用户名，避免老用户以为「只要密码」的用法坏了
    legacyPasswordMode: userCount === 1,
  };
  return NextResponse.json(payload);
}

/** DELETE：登出 */
export async function DELETE() {
  return clearSessionCookie(NextResponse.json({ success: true }));
}
