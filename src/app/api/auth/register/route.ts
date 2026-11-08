import { NextResponse } from 'next/server';
import { applySessionCookie, checkRateLimit, clearRateLimit, clientIp } from '@/lib/auth';
import { registerWithInvite } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * 邀请码注册：{ code, username, password }
 *
 * 一次性邀请码由管理员在「设置 → 账号与邀请码」生成。注册成功直接建立会话，
 * 省掉「注册完再登录一次」的多余步骤。
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: '尝试次数过多，请 10 分钟后再试' },
      { status: 429 }
    );
  }

  let code = '';
  let username = '';
  let password = '';
  try {
    const body = (await req.json()) as { code?: string; username?: string; password?: string };
    code = String(body.code ?? '').trim();
    username = String(body.username ?? '').trim();
    password = String(body.password ?? '');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  let result;
  try {
    result = await registerWithInvite({ code, username, password });
  } catch (err) {
    console.error('[zobby] 注册失败', err);
    return NextResponse.json(
      { success: false, error: '服务端数据目录不可写，请检查 data 目录权限' },
      { status: 500 }
    );
  }

  if (!result.ok || !result.user) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  clearRateLimit(ip);
  const res = NextResponse.json({ success: true, user: result.user });
  return applySessionCookie(res, req, result.user.id);
}
