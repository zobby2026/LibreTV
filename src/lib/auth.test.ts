import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE,
  checkPassword,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  sessionFromCookieHeader,
  sessionUserId,
  signSessionFor,
  verifySession,
  verifySessionUser,
} from './auth';

/**
 * 会话鉴权单测：HMAC 签名/校验、过期、防篡改、跨用户隔离、密码恒定时间比较、登录限流。
 * 纯函数 + 内存状态，不需要网络与 IndexedDB。
 */

const TEST_PASSWORD = 'test-password-123';

beforeAll(() => {
  process.env.PASSWORD = TEST_PASSWORD;
});

afterAll(() => {
  delete process.env.PASSWORD;
});

describe('signSessionFor / verifySessionUser', () => {
  it('新签发的会话能取回同一个 userId', () => {
    const { token, expiresAt } = signSessionFor('user-abc');
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(verifySessionUser(token)).toBe('user-abc');
    expect(verifySession(token)).toBe(true);
  });

  it('中文 / 特殊字符 userId 往返无损', () => {
    for (const id of ['张三', 'a.b.c', 'user with space', 'emoji-🎬']) {
      expect(verifySessionUser(signSessionFor(id).token)).toBe(id);
    }
  });

  it('过期会话被拒绝', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { token } = signSessionFor('user-abc');
    // 快进 91 天（TTL 90 天）
    vi.setSystemTime(new Date('2026-04-02T00:00:00Z'));
    expect(verifySessionUser(token)).toBeNull();
    vi.useRealTimers();
  });

  it('篡改 payload（换 userId 但沿用旧签名）被拒绝', () => {
    const { token } = signSessionFor('victim');
    const sig = token.slice(token.lastIndexOf('.') + 1);
    const expiresAt = token.split('.')[2];
    const forgedId = Buffer.from('attacker', 'utf8').toString('base64url');
    expect(verifySessionUser(`v2.${forgedId}.${expiresAt}.${sig}`)).toBeNull();
  });

  it('篡改过期时间被拒绝', () => {
    const { token } = signSessionFor('user-abc');
    const sig = token.slice(token.lastIndexOf('.') + 1);
    const forged = `v2.${Buffer.from('user-abc').toString('base64url')}.${Date.now() + 9e8}.${sig}`;
    expect(verifySessionUser(forged)).toBeNull();
  });

  it('旧版单密码会话（无版本前缀）一律失效', () => {
    // 升级到多用户后，老 token 只剩 `<expires>.<hmac>` 两段：
    // 签名密钥可能还一样，但必须靠版本前缀挡住，否则会被当成「没有 userId 的合法会话」
    const payload = String(Date.now() + 60_000);
    const secret = crypto.createHash('sha256').update(`${TEST_PASSWORD}:libretv::session-salt`).digest('hex');
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifySessionUser(`${payload}.${sig}`)).toBeNull();
    expect(verifySession(`${payload}.${sig}`)).toBe(false);
  });

  it('用自算 HMAC 伪造签名也无法通过（密钥派生含盐）', () => {
    const payload = `v2.${Buffer.from('admin').toString('base64url')}.${Date.now() + 60_000}`;
    const naiveSecret = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');
    const naive = crypto.createHmac('sha256', naiveSecret).update(payload).digest('hex');
    expect(verifySessionUser(`${payload}.${naive}`)).toBeNull();
  });

  it('格式非法的 token 一律拒绝', () => {
    expect(verifySessionUser(undefined)).toBeNull();
    expect(verifySessionUser('')).toBeNull();
    expect(verifySessionUser('no-dot-token')).toBeNull();
    expect(verifySessionUser('.sig')).toBeNull();
    expect(verifySessionUser('abc.not-hex-sig')).toBeNull();
    expect(verifySessionUser('v9.yWJj.9999999999999.deadbeef')).toBeNull();
  });
});

describe('sessionUserId / sessionFromCookieHeader', () => {
  it('从 Cookie 头解析出用户', () => {
    const { token } = signSessionFor('user-abc');
    expect(sessionUserId(`${SESSION_COOKIE}=${token}`)).toBe('user-abc');
    expect(sessionUserId(`other=1; ${SESSION_COOKIE}=${token}; x=2`)).toBe('user-abc');
  });

  it('缺失 / 篡改 / 无关 Cookie 头拒绝', () => {
    const { token } = signSessionFor('user-abc');
    expect(sessionUserId(null)).toBeNull();
    expect(sessionUserId('')).toBeNull();
    expect(sessionUserId('other=1')).toBeNull();
    expect(sessionUserId(`${SESSION_COOKIE}=${token}x`)).toBeNull();
    expect(sessionFromCookieHeader(null)).toBe(false);
    expect(sessionFromCookieHeader(`other=1`)).toBe(false);
  });
});

describe('会话密钥来源', () => {
  it('未配置 PASSWORD 时不再退化成常量密钥（可被照抄伪造）', async () => {
    const saved = process.env.PASSWORD;
    const savedProxy = process.env.PROXY_SECRET;
    const savedDir = process.env.LIBRETV_DATA_DIR;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ltv-secret-'));
    delete process.env.PASSWORD;
    delete process.env.PROXY_SECRET;
    process.env.LIBRETV_DATA_DIR = tmp;
    try {
      vi.resetModules();
      const mod = await import('./auth');
      const { token } = mod.signSessionFor('user-abc');
      expect(mod.verifySessionUser(token)).toBe('user-abc');
      // 密钥落盘，重启后同一目录仍然认这个会话
      const file = path.join(tmp, '.session-secret');
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8').trim().length).toBeGreaterThanOrEqual(32);

      vi.resetModules();
      const again = await import('./auth');
      expect(again.verifySessionUser(token)).toBe('user-abc');
    } finally {
      process.env.PASSWORD = saved;
      if (savedProxy !== undefined) process.env.PROXY_SECRET = savedProxy;
      else delete process.env.PROXY_SECRET;
      if (savedDir !== undefined) process.env.LIBRETV_DATA_DIR = savedDir;
      else delete process.env.LIBRETV_DATA_DIR;
      vi.resetModules();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('checkPassword（旧的单密码校验，保留给迁移期）', () => {
  it('正确密码通过，错误密码拒绝', () => {
    expect(checkPassword(TEST_PASSWORD)).toBe(true);
    expect(checkPassword('wrong')).toBe(false);
    expect(checkPassword('')).toBe(false);
  });

  it('未配置 PASSWORD 时一律拒绝', () => {
    const saved = process.env.PASSWORD;
    delete process.env.PASSWORD;
    try {
      expect(checkPassword(TEST_PASSWORD)).toBe(false);
    } finally {
      process.env.PASSWORD = saved;
    }
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => new Request('http://x/', { headers });

  it('取 X-Forwarded-For 第一段', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('回落到 X-Real-IP 与 unknown', () => {
    expect(clientIp(req({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(clientIp(req({}))).toBe('unknown');
  });
});

describe('checkRateLimit', () => {
  afterEach(() => {
    clearRateLimit('1.2.3.4');
    clearRateLimit('5.6.7.8');
  });

  it('窗口内允许 MAX_ATTEMPTS 次后拒绝', () => {
    clearRateLimit('1.2.3.4');
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('1.2.3.4')).toBe(true);
    }
    expect(checkRateLimit('1.2.3.4')).toBe(false);
  });

  it('不同 IP 互不影响', () => {
    expect(checkRateLimit('5.6.7.8')).toBe(true);
    // 耗尽 1.2.3.4 不影响 5.6.7.8
    for (let i = 0; i < 11; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('5.6.7.8')).toBe(true);
  });

  it('clearRateLimit 解除限制', () => {
    clearRateLimit('1.2.3.4');
    for (let i = 0; i < 11; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(false);
    clearRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(true);
  });
});
