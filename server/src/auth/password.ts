import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// 비밀번호는 Node 내장 scrypt로 해시한다. 저장 형식: scrypt$N$r$p$소금$해시 (base64)

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFC'), salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algorithm !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/**
 * 비밀번호 규칙 (개인정보 안전성 확보조치 기준 해설서 권고):
 * 영문 대문자·소문자·숫자·특수문자 중 2종류 이상이면 10자 이상, 3종류 이상이면 8자 이상.
 * 규칙에 맞으면 null, 아니면 안내 문구를 돌려준다.
 */
export function checkPasswordPolicy(password: string): string | null {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const ok = (kinds >= 2 && password.length >= 10) || (kinds >= 3 && password.length >= 8);
  return ok
    ? null
    : '비밀번호는 영문 대·소문자, 숫자, 특수문자 중 2종류 이상이면 10자 이상, 3종류 이상이면 8자 이상이어야 합니다.';
}
