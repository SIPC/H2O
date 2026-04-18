import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64

// 使用 scrypt 生成密码哈希，格式: scrypt$盐$摘要
export function hashPassword(plain: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex")

  return `scrypt$${salt}$${hash}`
}

// 校验明文密码是否匹配已存哈希
export function verifyPassword(plain: string, encoded: string) {
  const [algo, salt, hash] = encoded.split("$")
  if (algo !== "scrypt" || !salt || !hash) return false

  const digest = scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })

  const stored = Buffer.from(hash, "hex")
  if (stored.length !== digest.length) return false
  return timingSafeEqual(stored, digest)
}
