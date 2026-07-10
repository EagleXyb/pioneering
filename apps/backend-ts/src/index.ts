// 启动入口 —— 对应 Python app/main.py 的 if __name__ == "__main__"
import { buildApp } from './app.js'
import { env } from './config/env.js'

async function start() {
  try {
    const app = await buildApp()
    await app.listen({ host: env.HOST, port: env.PORT })
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`)
  } catch (err) {
    console.error('启动失败:', err)
    process.exit(1)
  }
}

start()
