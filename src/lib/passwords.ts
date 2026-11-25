import crypto from 'node:crypto';

/**
 * 密码哈希（Web Crypto PBKDF2-SHA256，硬件加速）：
 *
 * Cloudflare Workers 对 `crypto.scryptSync(N=16384)` 的内存(16MB)与同步 CPU 耗时极容易触发
 * 免费版 10ms CPU 超限或 500 崩溃；改用原生 `crypto.subtle.deriveBits` (PBKDF2-SHA256,
 * 100,000 次迭代) 由底层 BoringSSL/C++ 执行，耗时 < 2ms 且几乎零 JS 堆开销。
 *
 * 同时保留对历史 `scrypt$N$r$p$saltB64$hashB64` 格式的验证兼容，
 * 登录成功时由 user-store 自动将旧哈希无缝升级为新格式。
 */

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePbkdf2(password: string, salt: Uint8Array, iterations: number, keyBytes: number): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const enc = new TextEncoder();
    const keyMaterial = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const saltCopy = new Uint8Array(salt);
    const bits = await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: saltCopy,
        iterations,
      },
      keyMaterial,
      keyBytes * 8
    );
    return new Uint8Array(bits);
  }

  return new Promise<Uint8Array>((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, keyBytes, 'sha256', (err, derived) => {
      if (err) reject(err);
      else resolve(new Uint8Array(derived));
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(salt);
  } else {
    salt.set(crypto.randomBytes(16));
  }
  const hash = await derivePbkdf2(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BYTES);
  return ['pbkdf2', PBKDF2_ITERATIONS, toBase64(salt), toBase64(hash)].join('$');
}

export function needsPasswordRehash(stored: string): boolean {
  return !String(stored || '').startsWith('pbkdf2$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const raw = String(stored || '');
  const parts = raw.split('$');

  // 新版格式：pbkdf2$iterations$saltB64$hashB64
  if (parts.length === 4 && parts[0] === 'pbkdf2') {
    const iterations = parseInt(parts[1], 10);
    if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 1_000_000) return false;
    try {
      const salt = fromBase64(parts[2]);
      const expect = fromBase64(parts[3]);
      if (!salt.length || !expect.length) return false;
      const actual = await derivePbkdf2(password, salt, iterations, expect.length);
      return constantTimeEqual(actual, expect);
    } catch {
      return false;
    }
  }

  // 兼容旧版格式：scrypt$N$r$p$saltB64$hashB64
  if (parts.length === 6 && parts[0] === 'scrypt') {
    const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
    const n = parseInt(nRaw, 10);
    const r = parseInt(rRaw, 10);
    const p = parseInt(pRaw, 10);
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    try {
      const expectBuf = Buffer.from(hashB64, 'base64');
      const saltBuf = Buffer.from(saltB64, 'base64');
      const actualBuf = await new Promise<Buffer>((resolve, reject) => {
        crypto.scrypt(password, saltBuf, expectBuf.length, { N: n, r, p }, (err, derived) => {
          if (err) reject(err);
          else resolve(derived);
        });
      });
      if (actualBuf.length !== expectBuf.length) return false;
      return crypto.timingSafeEqual(actualBuf, expectBuf);
    } catch {
      return false;
    }
  }

  return false;
}
