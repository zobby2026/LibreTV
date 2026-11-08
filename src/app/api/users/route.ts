import { NextResponse } from 'next/server';
import { guardUser, jsonError } from '@/lib/api-guard';
import {
  changePassword,
  deleteUser,
  listUsers,
  setUserRole,
} from '@/lib/user-store';
import type { UserRole } from '@/lib/user-types';

export const runtime = 'nodejs';

/** 用户管理（仅管理员）。普通用户不需要看到别人的账号列表。 */

export async function GET(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;
  const users = await listUsers();
  return NextResponse.json({ users, selfId: gate.user.id });
}

/** PATCH：改角色 { id, role } 或重置密码 { id, newPassword } */
export async function PATCH(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;

  let body: { id?: string; role?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('请求格式错误', 400);
  }
  const id = String(body.id ?? '');
  if (!id) return jsonError('缺少用户 id', 400);

  if (body.role !== undefined) {
    const role = body.role as UserRole;
    if (role !== 'admin' && role !== 'user') return jsonError('角色只能是 admin 或 user', 400);

    // 不能把最后一个管理员降级，否则没人能再管理账号
    if (role === 'user') {
      const users = await listUsers();
      const target = users.find((u) => u.id === id);
      if (!target) return jsonError('用户不存在', 404);
      if (target.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
        return jsonError('不能降级最后一个管理员', 400);
      }
    }
    const ok = await setUserRole(id, role);
    if (!ok) return jsonError('用户不存在', 404);
    return NextResponse.json({ success: true });
  }

  if (body.newPassword !== undefined) {
    const err = await changePassword(id, String(body.newPassword));
    if (err) return jsonError(err, 400);
    return NextResponse.json({ success: true });
  }

  return jsonError('没有要修改的内容', 400);
}

export async function DELETE(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!id) return jsonError('缺少用户 id', 400);
  if (id === gate.user.id) return jsonError('不能删除自己当前登录的账号', 400);

  const ok = await deleteUser(id);
  if (!ok) return jsonError('删除失败：用户不存在，或这是最后一个管理员', 400);
  return NextResponse.json({ success: true });
}
