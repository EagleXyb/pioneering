// 技能管理路由（L3 管理面）
//
//   GET  /skills                      列出可用技能（已注册 + 目录发现，合并去重）
//   POST /skills/:name/activate       启用（写入白名单 + 热注册 + 图缓存失效）
//   POST /skills/:name/deactivate     停用（移出白名单 + 反注册 + 回收工具）
//   POST /skills/reload               重新扫描目录并对齐白名单
//
// 数据源：
//   1) ComponentRegistry.listSkills() —— 已注册技能
//   2) SkillLoader.discover(skills.auto_discover_dirs) —— 目录扫描发现、尚未激活的技能
//
// 持久化：`SKILLS_STATE_PATH`（默认 ./data/skills.state.json），启动时由
// `applyPersistedSkillState()` 覆盖 config.yaml 的 skills.active。
//
// 权限：读接口仅需登录（authGuard）；写接口要求管理员（adminGuard，ADMIN_USER_IDS）。
import { FastifyPluginAsync } from 'fastify'
import {
  cleanupSnapshots,
  getConfig,
  getRegistry,
  getSkillMeta,
  setDefaultVersion,
  SkillLoader,
} from '@pioneering/modu-agent'
import { authGuard } from '../plugins/auth.js'
import { adminGuard } from '../plugins/admin.js'
import { readSkillState, setActiveSkills } from '../core/skill-state.js'
import { invalidateAgentGraphCache } from '../core/agent-bridge.js'

export interface SkillBrief {
  name: string
  description: string
  version: string
  tags: string[]
  /** 技能内含工具数量 */
  toolCount: number
  /** 是否已注册激活（skills.active 白名单命中） */
  active: boolean
  /** 该技能当前占用的工具名（仅已注册技能有值） */
  toolNames?: string[]
  /** L3-2：内容指纹（有 manifest 的技能才有） */
  contentHash?: string
  /** L3-2：实际加载目录（快照回滚时为快照目录） */
  sourcePath?: string
  /** L3-2：是否从版本快照加载 */
  fromSnapshot?: boolean
  /** L3-2：manifest / 版本冲突等加载告警 */
  error?: string
}

/** 从未知异常中提取 message。 */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 当前生效的白名单：持久化文件优先，其次 config.yaml。 */
export function currentActiveSkills(
  config: { get: (k: string, d?: any) => any } = getConfig(),
): string[] {
  const state = readSkillState()
  if (state) return state.active
  const raw = config.get('skills.active', [])
  return Array.isArray(raw) ? raw.map(String) : []
}

/** 发现目录中的所有技能实例（单个失败不阻断）。 */
async function discoverAll(config: ReturnType<typeof getConfig>, registry = getRegistry()) {
  const dirsRaw = config.get('skills.auto_discover_dirs', [])
  const dirs = Array.isArray(dirsRaw) ? dirsRaw.map(String) : []
  if (dirs.length === 0) return []
  try {
    return await new SkillLoader(registry, config).discover(dirs)
  } catch (e: unknown) {
    console.warn(`[skills] discover failed: ${errorMessage(e)}`)
    return []
  }
}

export interface SkillToolConflict {
  skill: string
  tool: string
  /** 已占用该工具名的来源（另一技能名 / builtin 或 mcp） */
  existing: string
}

/**
 * 计算工具名冲突（L3-2）。
 *
 * 技能注册时同名工具会被跳过（只告警），管理面需要能**看见**这类静默丢失，
 * 否则表现为「技能启用了但工具没出现」。
 */
export function collectToolConflicts(
  skills: Array<{ name: string; toolNames?: string[] }>,
  registry: {
    listTools?: () => Record<string, unknown>
    skillToolNames?: (name: string) => string[]
  },
): SkillToolConflict[] {
  const owner = new Map<string, string>()
  for (const s of skills) {
    for (const t of s.toolNames ?? []) {
      if (!owner.has(t)) owner.set(t, s.name)
    }
  }
  const nonSkillTools = new Set(Object.keys(registry.listTools?.() ?? {}))
  const out: SkillToolConflict[] = []
  for (const s of skills) {
    for (const t of s.toolNames ?? []) {
      const o = owner.get(t)
      if (o && o !== s.name) {
        out.push({ skill: s.name, tool: t, existing: o })
      } else if (!o && nonSkillTools.has(t)) {
        out.push({ skill: s.name, tool: t, existing: 'builtin/mcp' })
      }
    }
  }
  return out
}

/** 同步注册表与白名单，并使图缓存失效。 */
async function syncSkills(config: ReturnType<typeof getConfig>) {
  const loader = new SkillLoader(getRegistry(), config)
  const diff = await loader.syncFromConfig()
  invalidateAgentGraphCache()
  return diff
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
          const meta = getSkillMeta(name)
          merged.set(name, {
            name,
            description: String(s.description ?? ''),
            version: String(s.version ?? ''),
            tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
            toolCount: Number(s.tool_count ?? 0),
            active: true,
            toolNames: registry.skillToolNames(name),
            ...(meta
              ? {
                  contentHash: meta.contentHash,
                  sourcePath: meta.sourcePath,
                  fromSnapshot: meta.fromSnapshot,
                  ...(meta.error ? { error: meta.error } : {}),
                }
              : {}),
          })
        }

        // 2) 目录发现（未激活，active=false）
        for (const skill of await discoverAll(config, registry)) {
          const name = skill.name()
          if (merged.has(name)) continue
          const meta = getSkillMeta(name)
          merged.set(name, {
            name,
            description: skill.description(),
            version: skill.version(),
            tags: skill.tags(),
            toolCount: skill.tools().length,
            active: false,
            ...(meta
              ? {
                  contentHash: meta.contentHash,
                  sourcePath: meta.sourcePath,
                  fromSnapshot: meta.fromSnapshot,
                  ...(meta.error ? { error: meta.error } : {}),
                }
              : {}),
          })
        }

        const skills = [...merged.values()]
        return {
          skills,
          total: skills.length,
          enabled: Boolean(config.get('skills.enabled', false)),
          active: currentActiveSkills(config),
          // L3-2：工具名冲突（技能之间 / 技能与既有工具）
          conflicts: collectToolConflicts(skills, registry),
        }
      },
    )

    // ---- 以下为写接口：管理员限定 ----
    app.register(async (adminApp) => {
      adminApp.addHook('preHandler', adminGuard)

      // POST /skills/:name/activate
      adminApp.post(
        '/skills/:name/activate',
        {
          schema: {
            tags: ['skills'],
            summary: '启用技能（写入白名单 + 热注册）',
            security: [{ BearerAuth: [] }],
          },
        },
        async (req, reply) => {
          const config = getConfig()
          if (!config.get('skills.enabled', false)) {
            return reply.code(409).send({
              code: 409,
              message: '技能子系统未开启（skills.enabled=false），请先在配置中启用',
            })
          }
          const name = String((req.params as { name?: string }).name ?? '').trim()
          if (!name) return reply.code(400).send({ code: 400, message: '技能名不能为空' })

          // 启用前先确认「可发现」：避免把拼写错误写进白名单
          const registered = getRegistry().getSkill(name)
          if (!registered) {
            const discovered = await discoverAll(config)
            if (!discovered.some((s) => s.name() === name)) {
              return reply.code(404).send({
                code: 404,
                message: `技能 '${name}' 未找到（检查 skills.auto_discover_dirs 与目录约定）`,
              })
            }
          }

          const next = [...new Set([...currentActiveSkills(config), name])]
          const state = setActiveSkills(next, req.user.id)
          // 防御性同步：无论持久化实现如何，都让运行时配置立即反映新白名单
          config.set('skills.active', state.active)
          let diff: { added: string[]; removed: string[]; missing: string[] }
          try {
            diff = await syncSkills(config)
          } catch (e: unknown) {
            return reply.code(500).send({
              code: 500,
              message: `技能注册失败：${errorMessage(e)}`,
              active: state.active,
            })
          }

          if (!getRegistry().getSkill(name)) {
            return reply.code(500).send({
              code: 500,
              message: `技能 '${name}' 未能注册（setup/注册阶段失败，见服务端日志）`,
              active: state.active,
              diff,
            })
          }

          req.log.info(
            { skill: name, action: 'activate', by: req.user.id, active: state.active },
            '[skills.audit] activate',
          )
          return {
            ok: true,
            name,
            active: state.active,
            diff,
            revisionBumped: diff.added.length > 0 || diff.removed.length > 0,
          }
        },
      )

      // POST /skills/:name/deactivate
      adminApp.post(
        '/skills/:name/deactivate',
        {
          schema: {
            tags: ['skills'],
            summary: '停用技能（移出白名单 + 反注册并回收工具）',
            security: [{ BearerAuth: [] }],
          },
        },
        async (req, reply) => {
          const config = getConfig()
          if (!config.get('skills.enabled', false)) {
            return reply.code(409).send({
              code: 409,
              message: '技能子系统未开启（skills.enabled=false）',
            })
          }
          const name = String((req.params as { name?: string }).name ?? '').trim()
          if (!name) return reply.code(400).send({ code: 400, message: '技能名不能为空' })

          const next = currentActiveSkills(config).filter((n) => n !== name)
          const state = setActiveSkills(next, req.user.id)
          config.set('skills.active', state.active)
          const diff = await syncSkills(config)
          req.log.info(
            { skill: name, action: 'deactivate', by: req.user.id, active: state.active },
            '[skills.audit] deactivate',
          )
          return {
            ok: true,
            name,
            active: state.active,
            diff,
            revisionBumped: diff.added.length > 0 || diff.removed.length > 0,
          }
        },
      )

      // POST /skills/reload —— 重新扫描目录并对齐白名单（开发态 / 修复后重试）
      adminApp.post(
        '/skills/reload',
        {
          schema: {
            tags: ['skills'],
            summary: '重新扫描技能目录并对齐白名单',
            security: [{ BearerAuth: [] }],
          },
        },
        async (_req, reply) => {
          const config = getConfig()
          if (!config.get('skills.enabled', false)) {
            return reply.code(409).send({
              code: 409,
              message: '技能子系统未开启（skills.enabled=false）',
            })
          }
          // 先让运行时配置与持久化状态对齐（reload 也用于「修复后重试」）
          const activeNow = currentActiveSkills(config)
          config.set('skills.active', activeNow)
          const diff = await syncSkills(config)
          const registered = Object.keys(getRegistry().listSkills())
          return { ok: true, diff, active: activeNow, registered }
        },
      )

      // POST /skills/:name/rollback —— 回滚到指定版本（只改默认指针，从快照加载）
      adminApp.post(
        '/skills/:name/rollback',
        {
          schema: {
            tags: ['skills'],
            summary: '回滚技能到指定版本（版本快照）',
            security: [{ BearerAuth: [] }],
          },
        },
        async (req, reply) => {
          const config = getConfig()
          if (!config.get('skills.enabled', false)) {
            return reply.code(409).send({
              code: 409,
              message: '技能子系统未开启（skills.enabled=false）',
            })
          }
          const name = String((req.params as { name?: string }).name ?? '').trim()
          const version = String((req.body as { version?: string } | null)?.version ?? '').trim()
          if (!name || !version) {
            return reply.code(400).send({ code: 400, message: '需要技能名与目标版本' })
          }

          const meta = getSkillMeta(name)
          if (!meta) {
            return reply.code(404).send({
              code: 404,
              message: `技能 '${name}' 没有版本信息（需 manifest.json 且已扫描）`,
            })
          }

          const result = setDefaultVersion(meta.baseDir, name, version)
          if (!result.ok) {
            return reply.code(404).send({ code: 404, message: result.message })
          }

          // 强制重新装载：反注册 → sync（discover 会按默认版本指针从快照加载）
          getRegistry().unregisterSkill(name)
          const diff = await syncSkills(config)
          req.log.info(
            { skill: name, version, by: req.user.id },
            '[skills.audit] rollback',
          )
          return {
            ok: true,
            name,
            version,
            snapshot: result.snapshot,
            active: currentActiveSkills(config),
            diff,
          }
        },
      )

      // POST /skills/prune —— 快照回收（L4-5.2）
      adminApp.post(
        '/skills/prune',
        {
          schema: {
            tags: ['skills'],
            summary: '回收旧版本快照（默认版本永不删除）',
            security: [{ BearerAuth: [] }],
          },
        },
        async (req, reply) => {
          const config = getConfig()
          if (!config.get('skills.enabled', false)) {
            return reply.code(409).send({
              code: 409,
              message: '技能子系统未开启（skills.enabled=false）',
            })
          }
          const body = (req.body ?? {}) as {
            keepLast?: number
            maxAgeDays?: number
            dryRun?: boolean
          }
          const dirsRaw = config.get('skills.auto_discover_dirs', [])
          const dirs = Array.isArray(dirsRaw) ? dirsRaw.map(String) : []
          const results = dirs.map((dir) => ({
            dir,
            ...cleanupSnapshots(dir, {
              keepLast: Number(body.keepLast ?? 5),
              maxAgeDays: Number(body.maxAgeDays ?? 90),
              dryRun: Boolean(body.dryRun),
            }),
          }))
          req.log.info(
            {
              by: req.user.id,
              dryRun: Boolean(body.dryRun),
              removed: results.reduce((n, r) => n + r.removed.length, 0),
            },
            '[skills.audit] prune',
          )
          return { ok: true, results }
        },
      )
    })
  })
}
