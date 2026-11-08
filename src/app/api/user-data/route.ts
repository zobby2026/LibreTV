import { NextResponse } from 'next/server';
import { guardUser, jsonError } from '@/lib/api-guard';
import { getUserData, saveUserData } from '@/lib/user-store';

export const runtime = 'nodejs';

/** 个人数据包上限：整包是收藏 + 历史 + 偏好，正常几十 KB；超过 2MB 说明客户端算错或有人捣乱 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * 个人数据（跟账号走的那部分）。
 *
 * GET  /api/user-data  → { data, updatedAt }
 * PUT  /api/user-data  → 整包覆盖，返回落盘后的 { data, updatedAt }
 *
 * 为什么是整包覆盖而不是增量：客户端本来就是一次性把 zustand 的持久化快照 +
 * IndexedDB 的历史/进度序列化成一个对象，做增量反而要在两边各写一套合并逻辑。
 * 单人写自己的文件、加上前端 800ms 防抖，整包覆盖的开销可以忽略。
 */
export async function GET(req: Request) {
  const gate = await guardUser(req);
  if (!gate.ok) return gate.response;
  const payload = await getUserData(gate.user.id);
  return NextResponse.json(payload);
}

export async function PUT(req: Request) {
  const gate = await guardUser(req);
  if (!gate.ok) return gate.response;

  const raw = await req.text();
  if (raw.length > MAX_BYTES) {
    return jsonError('个人数据过大，请清理观看历史后重试', 413);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw || '{}');
  } catch {
    return jsonError('请求格式错误', 400);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return jsonError('个人数据必须是对象', 400);
  }

  try {
    const saved = await saveUserData(gate.user.id, data as Record<string, unknown>);
    return NextResponse.json(saved);
  } catch (err) {
    console.error('[zobby] 保存个人数据失败', err);
    return jsonError('保存失败：服务端数据目录不可写', 500);
  }
}
