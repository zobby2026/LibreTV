import crypto from 'node:crypto';

/**
 * 密码哈希（scrypt，Node 内置）。
 *
 * 选 scrypt 而不是 bcrypt/argon2：两者都要多加一个原生依赖，而本站已有
 * SQLite/文件存储这类「零额外依赖」的取向；scrypt 的抗 GPU 强度对个人影视站足够。
 *
 * 存储格式：`scrypt$N$r$p$saltB64$hashB64`，参数随哈希一起存，
 * 以后调大成本参数时旧密码仍能验证。
 */

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const n = parseInt(nRaw, 10);
  const r = parseInt(rRaw, 10);
  const p = parseInt(pRaw, 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let expectBuf: Buffer;
  let actualBuf: Buffer;
  try {
    expectBuf = Buffer.from(hashB64, 'base64');
    actualBuf = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expectBuf.length, {
      N: n,
      r,
      p,
    });
  } catch {
    return false;
  }
  if (actualBuf.length !== expectBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectBuf);
}
