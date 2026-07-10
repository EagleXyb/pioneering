// 认证插件 —— 对应 Python app/api/deps.py 的 get_current_user / get_optional_user
import { FastifyReply, FastifyRequest } from 'fastify'
import { decodeAccessToken } from '../core/security.js'

// 对应 Python: get_current_user（强制认证）
export async function authGuard(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return reply.code(401).send({ code: 401, message: '缺少认证令牌' })
  }

  const token = auth.slice(7)
  const payload = decodeAccessToken(token)
  if (!payload?.sub) {
    return reply.code(401).send({ code: 401, message: '认证令牌无效或已过期' })
  }

  const user = await req.server.prisma.user.findUnique({
    where: { id: payload.sub },
  })

  if (!user) {
    return reply.code(401).send({ code: 401, message: '用户不存在' })
  }

  req.user = user
}

// 对应 Python: get_optional_user（可选认证，失败不报错）
export async function optionalAuthGuard(req: FastifyRequest, reply: FastifyReply) {
  try {
    await authGuard(req, reply)
  } catch {
    // 忽略认证错误
  }
}
