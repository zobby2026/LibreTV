import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPassword, needsPasswordRehash, verifyPassword } from './passwords';

describe('passwords (WebCrypto PBKDF2 + scrypt compat)', () => {
  it('使用 pbkdf2 生成哈希并能正确校验', async () => {
    const hash = await hashPassword('my-secret-pass');
    expect(hash.startsWith('pbkdf2$100000$')).toBe(true);
    expect(needsPasswordRehash(hash)).toBe(false);
    expect(await verifyPassword('my-secret-pass', hash)).toBe(true);
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('向后兼容校验历史 scrypt 哈希并标记需要平滑升级', async () => {
    const salt = crypto.randomBytes(16);
    const derived = crypto.scryptSync('legacy-pass', salt, 64, { N: 1024, r: 8, p: 1 });
    const legacyStored = ['scrypt', 1024, 8, 1, salt.toString('base64'), derived.toString('base64')].join('$');

    expect(needsPasswordRehash(legacyStored)).toBe(true);
    expect(await verifyPassword('legacy-pass', legacyStored)).toBe(true);
    expect(await verifyPassword('bad-pass', legacyStored)).toBe(false);
  });

  it('非法存储串返回 false 而不抛异常', async () => {
    expect(await verifyPassword('123456', '')).toBe(false);
    expect(await verifyPassword('123456', 'pbkdf2$bad$salt$hash')).toBe(false);
    expect(await verifyPassword('123456', 'scrypt$bad$8$1$aa$bb')).toBe(false);
  });
});
