import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const ALGO = "scrypt"
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 64
const SALT_LEN = 16

const SALT_HEX_LEN = SALT_LEN * 2
const HASH_HEX_LEN = KEY_LEN * 2
const MAX_ENCODED_LEN = 256

const HEX_RE = /^[0-9a-f]+$/i

type ParsedHash = {
  salt: string
  storedDigest: Buffer
}

function parseEncodedHash(encoded: string): ParsedHash | null {
  // 防御：限制输入体积，避免异常长字符串进入后续计算
  if (typeof encoded !== "string" || encoded.length === 0) return null
  if (encoded.length > MAX_ENCODED_LEN) return null

  const parts = encoded.split("$")
  if (parts.length !== 3) return null

  const [algo, saltHex, hashHex] = parts
  if (algo !== ALGO) return null

  // 固定长度 + 严格 hex 校验，拒绝畸形输入
  if (saltHex.length !== SALT_HEX_LEN || !HEX_RE.test(saltHex)) return null
  if (hashHex.length !== HASH_HEX_LEN || !HEX_RE.test(hashHex)) return null

  const storedDigest = Buffer.from(hashHex, "hex")
  if (storedDigest.length !== KEY_LEN) return null

  return { salt: saltHex, storedDigest }
}

// 使用 scrypt 生成密码哈希，格式: scrypt$盐$摘要
export function hashPassword(plain: string) {
  const salt = randomBytes(SALT_LEN).toString("hex")
  const hash = scryptSync(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex")

  return `${ALGO}$${salt}$${hash}`
}

// 校验明文密码是否匹配已存哈希
export function verifyPassword(plain: string, encoded: string) {
  if (typeof plain !== "string" || plain.length === 0) return false

  const parsed = parseEncodedHash(encoded)
  if (!parsed) return false

  try {
    const digest = scryptSync(plain, parsed.salt, KEY_LEN, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })

    if (digest.length !== parsed.storedDigest.length) return false
    return timingSafeEqual(parsed.storedDigest, digest)
  } catch {
    // 任意解析/计算异常统一视为校验失败
    return false
  }
}
