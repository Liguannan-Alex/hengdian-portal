/**
 * 口令散列：使用 Node 内置 scrypt，不引入需要编译的第三方库。
 *
 * 存储格式 `scrypt$N$r$p$salt$hash`，全部为十六进制或十进制文本，
 * 便于后续调整参数时按前缀识别旧记录并在登录成功时重新散列。
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64
const SALT_LENGTH = 16
// scrypt 默认 maxmem 为 32MB，N=16384/r=8 需要约 16MB，留出余量避免不同平台报错。
const MAX_MEM = 64 * 1024 * 1024

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

/** 校验口令强度。返回错误说明，通过时返回 null。 */
export function validatePassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) return `口令至少 ${MIN_PASSWORD_LENGTH} 位`
  if (value.length > MAX_PASSWORD_LENGTH) return `口令最多 ${MAX_PASSWORD_LENGTH} 位`
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return '口令需同时包含字母和数字'
  return null
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEM })
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('hex'), derived.toString('hex')].join('$')
}

/**
 * 校验口令。任何格式异常一律返回 false，不抛出，避免把存储细节暴露给调用方。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, rawN, rawR, rawP, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !rawN || !rawR || !rawP || !saltHex || !hashHex) return false

  const N = Number(rawN)
  const r = Number(rawR)
  const p = Number(rawP)
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false

  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false

  let derived: Buffer
  try {
    derived = await scryptAsync(password, salt, expected.length, { N, r, p, maxmem: MAX_MEM })
  } catch {
    return false
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected)
}
