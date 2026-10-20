// 管理员守卫（L3）
//
// 背景：技能管理是**平台级写操作**（改白名单 = 改所有用户的可用能力），
// 不能沿用 authGuard（只校验登录）。本仓库 `users` 表暂无 role 字段，
// 因此用环境变量 `ADMIN_USER_IDS` 做最小可行授权，避免为加一个角色字段而迁移。
//
// fail-closed：未配置 ADMIN_USER_IDS 时，所有管理写接口一律 403
// （宁可禁用管理面，也不能让任意登录用户改技能白名单）。
import { FastifyReply, FastifyRequest } from 'fastify'

import { env } from '../config/env.js'

/** 解析管理员 id 列表（逗号分隔，去空）。 */
export function adminUserIds(): string[] {
  return String(env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 前置守卫：必须在 authGuard 之后使用（依赖 req.user）。 */
export async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
  const ids = adminUserIds()
  if (ids.length === 0) {
    return reply.code(403).send({
      code: 403,
      message: '技能管理未启用：请配置环境变量 ADMIN_USER_IDS（逗号分隔的用户 id）',
    })
  }
  const userId = req.user?.id
  if (!userId || !ids.includes(userId)) {
    return reply.code(403).send({ code: 403, message: '需要管理员权限' })
  }
}
