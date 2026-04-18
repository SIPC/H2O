import { randomBytes } from "node:crypto"

// 生成用户节点认证用长静态 token
export function createUserAuthToken() {
  return randomBytes(24).toString("hex")
}
