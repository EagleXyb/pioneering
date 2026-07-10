// 认证安全工具 —— 对应 Python app/core/security.py
// bcrypt 密码哈希 + HS256 JWT 签发/校验
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// 对应 Python: hash_password
export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, bcrypt.genSaltSync())
}

// 对应 Python: verify_password
export function verifyPassword(plainPassword: string, hashedPassword: string): boolean {
  return bcrypt.compareSync(plainPassword, hashedPassword)
}

// 对应 Python: create_access_token(sub, extra_claims)
export function createAccessToken(sub: string, extraClaims?: Record<string, unknown>): string {
  const payload: Record<string, unknown> = {
    sub,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + env.JWT_EXPIRATION_HOURS * 3600,
  }
  if (extraClaims) {
    Object.assign(payload, extraClaims)
  }
  return jwt.sign(payload, env.JWT_SECRET, { algorithm: 'HS256' })
}

// 对应 Python: decode_access_token(token) -> dict | None
export interface JwtPayload {
  sub?: string
  exp?: number
  iat?: number
  [key: string]: unknown
}

export function decodeAccessToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload
    return payload
  } catch {
    return null
  }
}
