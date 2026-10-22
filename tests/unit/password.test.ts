import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../../server/src/auth/password.ts';

describe('비밀번호', () => {
  it('해시한 비밀번호만 맞다고 판단한다', async () => {
    const hash = await hashPassword('가람Test1234!');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('가람Test1234!', hash)).toBe(true);
    expect(await verifyPassword('가람Test1234?', hash)).toBe(false);
  });

  it.each([
    ['abcdefghij', false], // 1종류
    ['abcde12345', true], // 2종류 10자
    ['abcd1234', false], // 2종류 8자
    ['Abcd123!', true], // 4종류 8자
    ['Abc12345', true], // 3종류 8자
  ])('규칙: %s → %s', (password, ok) => {
    expect(checkPasswordPolicy(password) === null).toBe(ok);
  });
});
