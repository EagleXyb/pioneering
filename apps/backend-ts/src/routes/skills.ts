// 技能管理路由（Skill 子系统，只读）
//
//   GET /skills   列出可用技能（已注册 + 目录发现，合并去重）
//
// 数据源（均只读，不改变运行时行为）：
//   1) ComponentRegistry.listSkills() —— 已注册技能
//      （skills.enabled=true 时由 SkillLoader.loadFromConfig 激活 skills.active 白名单）
//   2) SkillLoader.discover(skills.auto_discover_dirs) —— 目录扫描发现、尚未激活的技能
//
// 与 /mcp/servers 同范式：配置来源 modu-agent RuntimeConfig，单个发现失败
// 不阻断（SkillLoader 内部已做加载隔离），整体失败降级为返回已注册部分。
import { FastifyPluginAsync } from 'fastify'
import { getConfig, getRegistry, SkillLoader } from '@pioneering/modu-agent'
import { authGuard } from '../plugins/auth.js'

export interface SkillBrief {
  name: string
  description: string
  version: string
  tags: string[]
  /** 技能内含工具数量 */
  toolCount: number
  /** 是否已注册激活（skills.active 白名单命中） */
  active: boolean
}

/** 从未知异常中提取 message。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export const skillsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(async (app) => {
    // 技能管理端点强制认证（对齐 agent / mcp 路由）
    app.addHook('preHandler', authGuard)

    // GET /skills —— 列出可用技能
    app.get(
      '/skills',
      {
        schema: {
          tags: ['skills'],
          summary: '列出可用技能（已注册 + 目录发现）',
          security: [{ BearerAuth: [] }],
        },
      },
      async () => {
        const config = getConfig()
        const registry = getRegistry()
        const merged = new Map<string, SkillBrief>()

        // 1) 已注册技能（active=true）
        for (const s of Object.values(registry.listSkills())) {
          const name = String(s.name ?? '')
          if (!name) continue
          merged.set(name, {
            name,
            description: String(s.description ?? ''),
            version: String(s.version ?? ''),
            tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
            toolCount: Number(s.tool_count ?? 0),
            active: true,
          })
        }

        // 2) 目录发现（未激活，active=false）
        const dirs = (config.get('skills.auto_discover_dirs', []) ?? []) as unknown
        if (Array.isArray(dirs) && dirs.length > 0) {
          try {
            const discovered = await new SkillLoader(registry, config).discover(
              dirs.map(String),
            )
            for (const skill of discovered) {
              const name = skill.name()
              if (merged.has(name)) continue
              merged.set(name, {
                name,
                description: skill.description(),
                version: skill.version(),
                tags: skill.tags(),
                toolCount: skill.tools().length,
                active: false,
              })
            }
          } catch (e) {
            // 发现失败不阻断：返回已注册部分，行为与 SkillLoader 加载隔离一致
            app.log.warn(`[skills] discover failed: ${errorMessage(e)}`)
          }
        }

        const skills = [...merged.values()]
        return { skills, total: skills.length }
      },
    )
  })
}
