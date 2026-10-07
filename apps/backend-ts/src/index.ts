// 启动入口 —— 对应 Python app/main.py 的 if __name__ == "__main__"
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startInterruptScheduler, stopInterruptScheduler } from './core/agent-scheduler.js'
import { activateConfiguredPacks } from './core/scenario-boot.js'

async function start() {
  try {
    const app = await buildApp()
    await app.listen({ host: env.HOST, port: env.PORT })
    // T2.2：启动 HITL 待答复项 TTL 清理（60s 扫频）
    startInterruptScheduler()
    // T5.3：按 scenario.packs 配置激活场景包（默认空，失败不阻断服务）
    await activateConfiguredPacks()
    app.log.info(`Server running at http://${env.HOST}:${env.PORT}`)

    // 优雅关停
    const shutdown = async () => {
      stopInterruptScheduler()
      await app.close()
      process.exit(0)
    }
    process.on('SIGINT', () => void shutdown())
    process.on('SIGTERM', () => void shutdown())
  } catch (err) {
    console.error('启动失败:', err)
    process.exit(1)
  }
}

start()
