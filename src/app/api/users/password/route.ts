import { NextResponse } from 'next/server';
import { guardUser, jsonError } from '@/lib/api-guard';
import { authenticate, changePassword } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * 修改自己的密码：{ oldPassword, newPassword }
 *
 * 要求验证旧密码——会话 Cookie 是 httpOnly 且 90 天有效，不验证旧密码的话，
 * 一台共用电脑上别人可以直接把密码改走、把账号锁死。
 */
export async function POST(req: Request) {
  const gate = await guardUser(req);
  if (!gate.ok) return gate.response;

  let oldPassword = '';
  let newPassword = '';
  try {
    const body = (await req.json()) as { oldPassword?: string; newPassword?: string };
    oldPassword = String(body.oldPassword ?? '');
    newPassword = String(body.newPassword ?? '');
  } catch {
    return jsonError('请求格式错误', 400);
  }

  const user = await authenticate(gate.user.username, oldPassword);
  if (!user) return jsonError('当前密码不正确', 400);

  const err = await changePassword(gate.user.id, newPassword);
  if (err) return jsonError(err, 400);

  return NextResponse.json({ success: true });
}
