import { NextResponse } from 'next/server';
import { guardUser, jsonError } from '@/lib/api-guard';
import { generateInvite, listInvites, revokeInvite } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * 邀请码管理（仅管理员）。
 *
 * - GET    列表（含已用/未用）
 * - POST   生成一个一次性邀请码 { note? }
 * - DELETE 撤销未使用的邀请码 ?code=
 */
export async function GET(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;
  return NextResponse.json({ invites: await listInvites() });
}

export async function POST(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;

  let note: string | undefined;
  try {
    const body = (await req.json()) as { note?: string };
    note = typeof body.note === 'string' ? body.note : undefined;
  } catch {
    // 允许空 body：不带备注直接生成
  }

  try {
    const invite = await generateInvite(gate.user.id, note);
    return NextResponse.json({ invite });
  } catch (err) {
    console.error('[zobby] 生成邀请码失败', err);
    return jsonError('生成失败：服务端数据目录不可写', 500);
  }
}

export async function DELETE(req: Request) {
  const gate = await guardUser(req, { admin: true });
  if (!gate.ok) return gate.response;

  const code = new URL(req.url).searchParams.get('code') || '';
  if (!code) return jsonError('缺少邀请码', 400);
  const ok = await revokeInvite(code);
  if (!ok) return jsonError('撤销失败：邀请码不存在或已被使用', 400);
  return NextResponse.json({ success: true });
}
