import { NextResponse } from 'next/server';
import {
  applySessionCookie,
  checkPassword,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  isPasswordConfigured,
} from '@/lib/auth';
import { countUsers, createFirstAdmin } from '@/lib/user-store';

export const runtime = 'nodejs';

/**
 * 站点初始化：创建第一个管理员账号。
 *
 * 只在「零账号」时可用，成功后直接建立会话，省掉「建好再登录一次」。
 *
 * 部署密钥（可选加固）：如果部署者设置了 PASSWORD 环境变量，本站的语义就变成
 * 「想知道这个密码的人才能初始化」——此时必须把 PASSWORD 一并提交，防止站点
 * 刚上线、还没来得及创建账号，就被公网上的陌生人抢注成管理员。
 * 没设 PASSWORD 时不校验，适合内网 / 自己机器上首次打开就建号。
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
  let setupKey = '';
  try {
    const body = (await req.json()) as {
      username?: string;
      password?: string;
      setupKey?: string;
    };
    username = String(body.username ?? '').trim();
    password = String(body.password ?? '');
    setupKey = String(body.setupKey ?? '');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
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

  if (userCount > 0) {
    return NextResponse.json(
      { success: false, error: '站点已完成初始化，请直接登录' },
      { status: 403 }
    );
  }

  // 配了 PASSWORD 就要求先验证它：既是"部署者身份"的证明，也顺手挡掉了抢注
  if (isPasswordConfigured() && !checkPassword(setupKey)) {
    return NextResponse.json(
      { success: false, error: '部署密钥不正确（即部署时设置的 PASSWORD）' },
      { status: 403 }
    );
  }

  let result;
  try {
    result = await createFirstAdmin({ username, password });
  } catch (err) {
    console.error('[zobby] 初始化失败', err);
    return NextResponse.json(
      { success: false, error: '写入失败：服务端数据目录不可写' },
      { status: 500 }
    );
  }

  if (!result.ok || !result.user) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  clearRateLimit(ip);
  console.log(`[zobby] 站点已初始化，管理员账号：${result.user.username}`);
  const res = NextResponse.json({ success: true, user: result.user });
  return applySessionCookie(res, req, result.user.id);
}
