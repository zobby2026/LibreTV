import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextResponse } from 'next/server';

/**
 * 会话鉴权：httpOnly cookie + HMAC 签名。
 *
 * 相比旧版的改进：
 * - 页面源码不再下发 sha256(password)，前端拿不到任何可重放的凭证；
 * - 兼容模式「哈希即凭证」被彻底移除；
 * - 登录接口只接受 POST body，不再把明文密码放 query。
 * - 多用户：会话里带 userId，服务端据此区分「谁在请求」。
 */

export const SESSION_COOKIE = 'ltv_session';
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 天

export function getPassword(): string {
  return process.env.PASSWORD || '';
}

export function isPasswordConfigured(): boolean {
  return getPassword().length > 0;
}

function getSecret(): string {
  if (process.env.PROXY_SECRET) return process.env.PROXY_SECRET;
  const password = getPassword();
  if (password) {
    return crypto.createHash('sha256').update(password + ':libretv::session-salt').digest('hex');
  }
  // 多用户部署下 PASSWORD 可能已经被删掉（它只用于首次引导出 admin）。
  // 此时绝不能退回到「常量密钥」——那等于全站共用一把可以照抄的签名钥匙，
  // 任何人都能自己造一个会话。改为在数据目录里持久化一把随机密钥。
  return localSecret();
}

let cachedSecret: string | null = null;

function localSecret(): string {
  if (cachedSecret) return cachedSecret;
  const dir = process.env.LIBRETV_DATA_DIR || path.join(process.cwd(), 'data');
  const file = path.join(dir, '.session-secret');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) {
      cachedSecret = existing;
      return existing;
    }
  } catch {
    // 文件不存在或不可读，往下生成
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, fresh, { mode: 0o600 });
  } catch {
    // 目录只读（如镜像内进程无写权限）：退化为进程内随机密钥。
    // 后果只是重启后所有人需重新登录，仍然无法被外部伪造。
    console.warn('[zobby] 无法持久化会话密钥，重启后现有登录状态将失效');
  }
  cachedSecret = fresh;
  return fresh;
}

function hmac(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/**
 * 多用户会话。
 *
 * token 格式：`v2.<userIdBase64Url>.<expiresAtMs>.<hmac>` —— 带版本前缀是为了
 * 让旧版「只有过期时间」的单密码会话自然失效（升级后所有人都要重登一次），
 * 而不是被误判成合法会话。userId 用 base64url 编码，不含点，可以直接用点分隔。
 */
const SESSION_VERSION = 'v2';

export function signSessionFor(userId: string): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${SESSION_VERSION}.${Buffer.from(userId, 'utf8').toString('base64url')}.${expiresAt}`;
  return { token: `${payload}.${hmac(payload)}`, expiresAt };
}

/** 校验签名与有效期，返回 userId；无效返回 null */
export function verifySessionUser(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const parts = payload.split('.');
  if (parts.length !== 3 || parts[0] !== SESSION_VERSION) return null;
  const expiresAt = parseInt(parts[2], 10);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
  try {
    const userId = Buffer.from(parts[1], 'base64url').toString('utf8');
    return userId || null;
  } catch {
    return null;
  }
}

/** 兼容旧调用点：只关心「是否已登录」 */
export function verifySession(token: string | undefined | null): boolean {
  return verifySessionUser(token) !== null;
}

function readCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const c of cookieHeader.split(';')) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    if (c.slice(0, eq).trim() === SESSION_COOKIE) {
      return decodeURIComponent(c.slice(eq + 1).trim());
    }
  }
  return null;
}

/** 当前请求对应的用户 id（未登录返回 null） */
export function sessionUserId(cookieHeader: string | null): string | null {
  return verifySessionUser(readCookie(cookieHeader));
}

/**
 * 把会话写进响应 Cookie。
 *
 * Secure 策略：COOKIE_SECURE 环境变量显式覆盖；否则按 x-forwarded-proto 推导。
 * 不能依赖 req.url——Next.js Route Handler 中它是内部转发地址，并非用户侧的原始协议。
 * 登录、注册两处都要用，抽出来避免两份实现漂移。
 */
export function applySessionCookie(res: NextResponse, req: Request, userId: string): NextResponse {
  const { token, expiresAt } = signSessionFor(userId);
  const secure = process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http') === 'https';
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
    path: '/',
  });
  return res;
}

/** 清掉会话 Cookie（登出） */
export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}

/** 客户端 IP，用于登录/注册限流（反向代理后取第一个 XFF） */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/** 恒定时间比较密码（比较 sha256 摘要避免长度泄漏） */
export function checkPassword(input: string): boolean {
  const password = getPassword();
  if (!password) return false;
  const a = crypto.createHash('sha256').update(input).digest();
  const b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 从请求 Cookie 中解析会话 */
export function sessionFromCookieHeader(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  const cookies = cookieHeader.split(';');
  for (const c of cookies) {
    const eq = c.indexOf('=');
    if (eq === -1) continue;
    const name = c.slice(0, eq).trim();
    if (name === SESSION_COOKIE) {
      return verifySession(decodeURIComponent(c.slice(eq + 1).trim()));
    }
  }
  return false;
}

// —— 登录速率限制（内存实现，单实例部署足够；多实例可换 Redis） ——

const attemptMap = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 10 * 60 * 1000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attemptMap.get(ip);
  if (!entry || now > entry.resetAt) {
    attemptMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export function clearRateLimit(ip: string): void {
  attemptMap.delete(ip);
}

// 定期清理过期限流记录，避免长期运行下 Map 膨胀
if (typeof setInterval === 'function') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of attemptMap) {
      if (now > entry.resetAt) attemptMap.delete(ip);
    }
  }, 60 * 1000);
  // 不阻止 Node 进程退出
  if (typeof timer.unref === 'function') timer.unref();
}
