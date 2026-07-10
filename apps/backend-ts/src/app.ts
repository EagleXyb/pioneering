// Fastify 应用 —— 对应 Python app/main.py 的 create_app()
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { env } from './config/env.js'
import { prismaPlugin } from './plugins/prisma.js'
import { corsPlugin } from './plugins/cors.js'
import { responseWrapperPlugin } from './plugins/response-wrapper.js'
import { errorHandlerPlugin } from './plugins/error-handler.js'
import { staticPlugin } from './plugins/static.js'
import { registerRoutes } from './routes/index.js'
import { randomUUID } from 'crypto'
import path from 'path'
import fs from 'fs'

// 对应 Python main.py 的 _setup_logging()
// 按日轮转，保留 30 天，写入 logs/backend/agent.log
function buildLoggerConfig() {
  // 确保日志目录存在（对应 Python: os.makedirs(log_dir, exist_ok=True)）
  const logDir = path.resolve(env.LOG_DIR, 'backend')
  fs.mkdirSync(logDir, { recursive: true })

  return {
    level: 'info',
    transport: {
      targets: [
        // 控制台输出（pino-pretty）
        {
          target: 'pino-pretty',
          level: 'info',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
        // 文件输出（pino-roll 按日轮转，保留 30 天）
        {
          target: 'pino-roll',
          level: 'info',
          options: {
            file: 'agent.log',
            dir: logDir,
            frequency: 'daily',
            mkdir: true,
            limit: { count: 30 },
          },
        },
      ],
    },
  }
}

export async function buildApp() {
  const fastify = Fastify({
    logger: buildLoggerConfig(),
    // 对应 Python: 每个请求分配 requestId
    genReqId: () => randomUUID(),
  })

  // Swagger/OpenAPI 文档（对应 FastAPI 的自动文档生成）
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'IAC Incubator API',
        description: '创路 Agent 后端服务 (TypeScript / Fastify)',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  })

  // 插件注册顺序对应 Python main.py 的中间件挂载顺序
  await fastify.register(prismaPlugin)
  await fastify.register(corsPlugin)
  await fastify.register(multipart, {
    limits: { fileSize: env.MAX_UPLOAD_SIZE },
  })
  await fastify.register(responseWrapperPlugin)
  await fastify.register(errorHandlerPlugin)
  await fastify.register(staticPlugin)

  // 路由
  await registerRoutes(fastify)

  return fastify
}
