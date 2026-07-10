// 路由注册入口 —— 对应 Python app/api/v1/__init__.py 的 API_PREFIX
import { FastifyInstance } from 'fastify'
import { systemRoutes } from './system.js'
import { authRoutes } from './auth.js'
import { userRoutes } from './user.js'
import { chatRoutes } from './chat.js'
import { uploadRoutes } from './upload.js'
import { agentRoutes } from './agent.js'

// 对应 Python: app.include_router(router, prefix=settings.API_PREFIX)
// 但各路由文件内已自带 prefix，这里只做注册
export async function registerRoutes(app: FastifyInstance) {
  await app.register(systemRoutes)
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(chatRoutes)
  await app.register(uploadRoutes)
  await app.register(agentRoutes)
}
