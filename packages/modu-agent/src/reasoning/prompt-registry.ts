// P2（T-14）: Prompt 注册表实现 + 全局单例。
//
// 设计约束（对齐 `perception/pipeline.ts` 的"注册表 + 逐项 try/catch"范式）：
//   1. 纯查表 + 纯渲染，无副作用、无 IO；
//   2. `register` 同 id 覆盖（宿主显式注册优先），便于"替换 prompt 不改内核源码"；
//   3. `render` 对未知 id / 渲染异常返回空串（调用方据此回退到内置字面量，
//      保证默认路径行为零变化）；
//   4. **不** import `core/registry.ts` / `graph/*`，避免 ESM 循环依赖 ——
//      `ComponentRegistry` 的 `registerPrompt/getPrompt/...` 是对本模块单例的**单向**委托。
//
// 字符等价：`renderTemplate` 仅替换 `{{name}}`，缺失变量原样保留。

import type {
  PromptMessage,
  PromptRegistry,
  PromptTemplate,
} from '../core/interfaces/prompt.js'
import { getConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[prompt-registry] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[prompt-registry] ${msg}`, ...args),
}

/**
 * 占位符正则：`{{name}}`（允许内部空白）。
 *
 * 注意：模板中的单花括号（JSON 示例、`{title}_{YYYY-MM-DD}.md` 等）不受影响，
 * 只有连续两个花括号才被视作占位符。
 */
const _PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

/** 渲染模板内容（不经注册表查找）。变量缺失时保留原占位符。 */
export function renderTemplateContent(
  tpl: PromptTemplate,
  vars: Record<string, unknown> = {},
): string {
  const raw = tpl.messages.map((m: PromptMessage) => m.content).join('\n\n')
  return raw.replace(_PLACEHOLDER_RE, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = vars[name]
      return value === undefined || value === null ? match : String(value)
    }
    // 字符等价保证：变量未提供时保留原占位符（不产生空串/多余分隔符）
    return match
  })
}

/**
 * 默认 Prompt 注册表。
 */
export class DefaultPromptRegistry implements PromptRegistry {
  private _templates: Map<string, PromptTemplate> = new Map()

  register(tpl: PromptTemplate): void {
    if (!tpl || !tpl.id) {
      throw new TypeError('PromptTemplate.id must be non-empty')
    }
    if (!Array.isArray(tpl.messages)) {
      throw new TypeError(`PromptTemplate.messages must be an array (id=${tpl.id})`)
    }
    const existed = this._templates.has(tpl.id)
    this._templates.set(tpl.id, tpl)
    if (!existed) {
      logger.info('Registered prompt template: %s (version=%s)', tpl.id, tpl.version)
    }
  }

  get(id: string): PromptTemplate | undefined {
    return this._templates.get(id)
  }

  has(id: string): boolean {
    return this._templates.has(id)
  }

  /** P3-B：移除已注册模板；不存在返回 false。 */
  unregister(id: string): boolean {
    const existed = this._templates.delete(id)
    if (existed) logger.info('Unregistered prompt template: %s', id)
    return existed
  }

  render(id: string, vars: Record<string, unknown> = {}): string {
    const tpl = this._templates.get(id)
    if (tpl === undefined) {
      return ''
    }
    return this.renderTemplate(tpl, vars)
  }

  renderTemplate(tpl: PromptTemplate, vars: Record<string, unknown> = {}): string {
    if (!tpl || !Array.isArray(tpl.messages)) {
      return ''
    }
    try {
      return renderTemplateContent(tpl, vars)
    } catch (e: any) {
      logger.warning('renderTemplate failed (id=%s): %s', tpl.id, String(e?.message ?? e))
      return ''
    }
  }

  renderOr(id: string, vars: Record<string, unknown>, fallback: PromptTemplate): string {
    const tpl = this._templates.get(id)
    if (tpl !== undefined) {
      const rendered = this.renderTemplate(tpl, vars)
      // 注册表条目渲染失败（异常/空 messages）时回退到内置字面量
      if (rendered !== '') return rendered
    }
    return this.renderTemplate(fallback, vars)
  }

  list(taskType?: string): PromptTemplate[] {
    const all = [...this._templates.values()]
    if (taskType === undefined || taskType === null || taskType === '') return all
    return all.filter((t) => t.taskTypes === undefined || t.taskTypes.includes(taskType))
  }
}

// ============================================================
// 全局单例（与 core/registry.ts 的 getRegistry/resetRegistry 同构）
// ============================================================

let _promptRegistry: PromptRegistry | null = null

/** 获取全局 Prompt 注册表（首次访问时创建空表，内置模板由装配层注册）。 */
export function getPromptRegistry(): PromptRegistry {
  if (_promptRegistry === null) {
    _promptRegistry = new DefaultPromptRegistry()
  }
  return _promptRegistry
}

/** 替换全局 Prompt 注册表（供测试隔离与装配层注入）。 */
export function setPromptRegistry(registry: PromptRegistry | null): void {
  _promptRegistry = registry
}

/** 重置全局 Prompt 注册表单例（测试清理用）。 */
export function resetPromptRegistry(): void {
  _promptRegistry = null
}

// ============================================================
// 便捷函数（供调用点直接消费，避免每处都取单例）
// ============================================================

/**
 * 注册表优先渲染，未注册时回退 `fallback` 模板。
 *
 * 调用点使用本函数即可同时获得：
 *   - 宿主可注册覆盖（`create_agent` 已注册内置模板，宿主 `register` 同 id 即替换）；
 *   - 未接线场景（直接调用构建函数的单元测试）与迁移前逐字节一致。
 */
export function renderPromptWithFallback(
  id: string,
  vars: Record<string, unknown>,
  fallback: PromptTemplate,
): string {
  // `prompt.registry.enabled=false` → 单点回滚到"始终使用内置模板对象"
  // （忽略宿主注册的覆盖模板，输出与迁移前逐字节一致）。
  try {
    if (!getConfig().get('prompt.registry.enabled', true)) {
      return renderTemplateContent(fallback, vars)
    }
  } catch {
    // 配置不可用时按启用处理（不改变默认行为）
  }
  try {
    return getPromptRegistry().renderOr(id, vars, fallback)
  } catch (e: any) {
    logger.warning('renderPromptWithFallback failed (id=%s): %s', id, String(e?.message ?? e))
    return renderTemplateContent(fallback, vars)
  }
}
