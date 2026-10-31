// 启动入口 —— 对应 Python app/main.py 的 if __name__ == "__main__"
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startInterruptScheduler, stopInterruptScheduler } from './core/agent-scheduler.js'
import { activateConfiguredPacks } from './core/scenario-boot.js'
import { applyPersistedSkillState } from './core/skill-state.js'
import { build_checkpointer, getCheckpointerStatus, getConfig } from '@pioneering/modu-agent'

async function start() {
  try {
    // L3：先应用管理面持久化的技能白名单（文件优先于 config.yaml），
    // 再构建 Fastify 应用——后续 create_agent 即按最终白名单注册技能。
    try {
      const { applied, active } = applyPersistedSkillState()
      if (applied) {
        console.info(`[skills] persisted state applied: ${active.join(',') || '(none)'}`)
      }
    } catch (e) {
      console.warn('[skills] apply persisted state failed (fallback to config.yaml):', e)
    }

    // 启动期探测 checkpointer：配置 sqlite 但原生依赖缺失时直接失败，
    // 避免"看起来持久化、重启后 HITL 暂停态全丢"的静默降级。
    const checkpointerType = String(getConfig().get('memory.checkpointer_type', 'memory'))
    await build_checkpointer(checkpointerType)
    console.info(`[checkpointer] ${JSON.stringify(getCheckpointerStatus())}`)

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
