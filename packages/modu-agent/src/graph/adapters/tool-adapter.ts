// 对应 Python: modu_graph/adapters/tool_adapter.py
// 工具适配器：ModuAgent BaseTool → LangChain StructuredTool。
//
// 将现有 components/action/tools/ 下的工具（CalculatorTool / SearchTool 等）
// 包装为 LangChain BaseTool，使 LangGraph 的 ToolNode 可直接消费。
//
// P2-8: 通过 with_tool_retry 为工具 invoke 添加指数退避重试，
// 仅捕获瞬时网络异常（TimeoutError / ConnectionError / httpx.TransportError）。
//
// 保留原 BaseTool 接口以支持双轨运行（legacy Coordinator 仍可调用原工具）。
import { DynamicStructuredTool, type StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import type { RuntimeConfig } from '../../config/runtime-config.js'
import { getConfig } from '../../config/runtime-config.js'
import type { ComponentRegistry } from '../../core/registry.js'
import { getRegistry } from '../../core/registry.js'
import { with_tool_retry } from './retry.js'
import { get_tool_rate_limiter } from './rate-limiter.js'
import {
  computeCacheKey,
  getToolResultCache,
  isToolCacheEnabled,
} from './tool-result-cache.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.tool_adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.tool_adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.tool_adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.tool_adapter] ${msg}`, ...args),
}

/**
 * 将 JSON Schema 转换为 Zod schema（用于 DynamicStructuredTool.schema）。
 *
 * 对应 Python _schema_to_pydantic_model。
 *
 * @param name 模型名称（未使用，保留接口兼容）
 * @param schema JSON Schema 字典（含 properties / required）
 * @returns ZodObject schema，或 null（schema 为空时）
 */
function _schema_to_zod(
  name: string,
  schema: Record<string, any>,
): z.ZodObject<any> | null {
  const properties = schema.properties || {}
  const required = new Set(schema.required || [])

  if (Object.keys(properties).length === 0) {
    return null
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [fieldName, fieldSpecRaw] of Object.entries(properties)) {
    const fieldSpec = fieldSpecRaw as Record<string, any>
    const jsonType = fieldSpec.type || 'string'
    const description = fieldSpec.description || ''

    let zodType: z.ZodTypeAny
    switch (jsonType) {
      case 'string':
        zodType = z.string()
        break
      case 'integer':
        zodType = z.number().int()
        break
      case 'number':
        zodType = z.number()
        break
      case 'boolean':
        zodType = z.boolean()
        break
      case 'array':
        zodType = z.array(z.any())
        break
      case 'object':
        zodType = z.record(z.any())
        break
      default:
        zodType = z.string()
    }

    // 附加描述
    if (description) {
      zodType = zodType.describe(description)
    }

    // 可选字段
    if (!required.has(fieldName)) {
      zodType = zodType.optional()
    }

    shape[fieldName] = zodType
  }

  return z.object(shape)
}

/**
 * 工具结果字符级截断（对应文档 §4.3 建议1）。
 *
 * 读取配置 `tools.max_result_chars.{tool_name}`，未单独配置时回退到 `default`。
 * 截断时在结果末尾追加 `...[truncated]` 标记，让 LLM 感知结果不完整。
 *
 * 配置值含义：
 *   - 0 或未配置：不截断（向后兼容，零开销）
 *   - 正整数：截断到该字符数
 *
 * @param json      工具返回的 JSON 字符串
 * @param toolName  工具名（用于读取 per-tool 配置）
 * @param config    运行时配置（null=不截断）
 * @returns 截断后的字符串
 */
function _truncateToolResult(
  json: string,
  toolName: string,
  config?: RuntimeConfig | null,
): string {
  if (!config) return json
  let maxCharsCfg: any
  try {
    maxCharsCfg = config.get('tools.max_result_chars', {}) ?? {}
  } catch {
    return json
  }
  if (!maxCharsCfg || typeof maxCharsCfg !== 'object') return json
  const limits = (maxCharsCfg as Record<string, any>)['limits'] ?? {}
  const toolLimit = typeof limits[toolName] === 'number' ? Number(limits[toolName]) : 0
  const defaultLimit = typeof (maxCharsCfg as Record<string, any>)['default'] === 'number'
    ? Number((maxCharsCfg as Record<string, any>)['default'])
    : 0
  // 工具名单独配置优先于 default；均为 0 时不截断
  const maxChars = toolLimit > 0 ? toolLimit : defaultLimit
  if (maxChars <= 0 || json.length <= maxChars) {
    return json
  }
  logger.debug(
    "Tool '%s' result truncated: %d → %d chars",
    toolName, json.length, maxChars,
  )
  return json.slice(0, maxChars) + '...[truncated]'
}

/**
 * 将 ModuAgent BaseTool 包装为 LangChain StructuredTool。
 *
 * ModuAgent BaseTool 接口：
 *   - name() → string
 *   - description() → string
 *   - parametersSchema() → Record<string, any> (JSON Schema)
 *   - invoke(params: Record, context: Record) → Promise<Record> | Record
 *
 * P2-8: 若提供 config 且 tools.retry.max_attempts > 1，则为 func
 * 包装指数退避重试，仅捕获瞬时网络异常。
 *
 * @param moduTool ModuAgent BaseTool 实例
 * @param config 运行时配置（null=不启用重试）
 * @returns LangChain DynamicStructuredTool 实例
 */
export function wrap_modu_tool(
  moduTool: import('../../core/interfaces/action.js').BaseTool,
  config?: RuntimeConfig | null,
): StructuredTool {
  const toolName = moduTool.name()
  const rawDesc = moduTool.description()
  const schema = moduTool.parametersSchema()

  // v1.2 §4.3 建议8/9：将 version() 与 followUpTools() 元数据注入工具描述，
  //   让 LLM 在工具选择决策时可见版本与组合关系（仅当非默认值时追加，避免噪声）
  const descParts: string[] = [rawDesc]
  // 建议8：版本元数据（非默认 '1.0.0' 时追加）
  let version = '1.0.0'
  try { version = moduTool.version() } catch { /* 默认 */ }
  if (version && version !== '1.0.0') {
    descParts.push(`[version: ${version}]`)
  }
  // 建议9：组合工具声明（非空时追加）
  let followUps: string[] = []
  try { followUps = moduTool.followUpTools() ?? [] } catch { /* 默认空 */ }
  if (followUps.length > 0) {
    descParts.push(`[followUp: ${followUps.join(', ')}]`)
  }
  const toolDesc = descParts.join(' ')

  const argsSchema = _schema_to_zod(`${toolName}_schema`, schema)

  // 同步/异步调用 ModuAgent 工具，返回 JSON 字符串结果
  const func = async (input: Record<string, any>): Promise<string> => {
    // 工具限流（对应文档 §2.5 建议7）：
    //   限流未启用或工具未配置 limits 时 tryAcquire 返回 true，零开销
    //   限流触发时返回标准错误结构，不调用底层工具
    const limiter = get_tool_rate_limiter()
    if (!limiter.tryAcquire(toolName)) {
      return JSON.stringify({
        status: 'error',
        error_code: 'TOOL_RATE_LIMITED',
        data: {
          message: `Tool '${toolName}' rate limit exceeded, please retry later`,
          tool_name: toolName,
        },
      })
    }

    // 工具结果缓存（对应文档 §4.3 建议2）：
    //   仅对显式配置的工具启用（tools.result_cache.tools.{tool_name}）
    //   命中缓存时直接返回，不调用底层工具；未命中时正常调用并写入缓存
    //   仅缓存成功结果（status === 'success'），错误结果不缓存
    const cacheCfg = isToolCacheEnabled(toolName)
    if (cacheCfg.enabled) {
      const cacheKey = computeCacheKey(toolName, input)
      const cache = getToolResultCache()
      const cached = cache.get(cacheKey)
      if (cached !== null) {
        logger.debug("Tool '%s' cache hit: key=%s", toolName, cacheKey)
        return cached
      }
      const result = await moduTool.invoke(input, {})
      const json = JSON.stringify(result)
      // 仅缓存成功结果，避免错误结果被反复返回
      if (result?.['status'] === 'success') {
        cache.set(cacheKey, json, cacheCfg.ttlMs)
        logger.debug("Tool '%s' cache set: key=%s ttl=%dms", toolName, cacheKey, cacheCfg.ttlMs)
      }
      return _truncateToolResult(json, toolName, config)
    }

    const result = await moduTool.invoke(input, {})
    const json = JSON.stringify(result)
    // 工具结果字符级截断（对应文档 §4.3 建议1）：
    //   按 tools.max_result_chars.{tool_name} 截断，避免大响应撑爆 LLM 上下文
    //   - 工具名未单独配置时回退到 default（default=0 表示不截断）
    //   - 截断时在末尾追加 "[truncated]" 标记，让 LLM 感知结果不完整
    return _truncateToolResult(json, toolName, config)
  }

  // P2-8: 应用指数退避重试包装
  let wrappedFunc = func
  if (config) {
    wrappedFunc = with_tool_retry(func, toolName, config)
  }

  return new DynamicStructuredTool({
    name: toolName,
    description: toolDesc,
    schema: argsSchema || z.object({}),
    func: wrappedFunc,
  })
}

/**
 * 从注册表构建 LangChain 工具列表。
 *
 * P2-8: 若提供 config，则为每个工具应用重试包装。
 *
 * @param registry 组件注册表（默认使用全局单例）
 * @param toolNames 指定工具名列表（null=注册表中全部工具）
 * @param config 运行时配置（null=不启用重试）
 * @returns LangChain StructuredTool 列表
 */
export function build_langchain_tools(
  registry?: ComponentRegistry | null,
  toolNames?: string[] | null,
  config?: RuntimeConfig | null,
): StructuredTool[] {
  if (!registry) {
    registry = getRegistry()
  }
  if (!config) {
    config = getConfig()
  }

  let allTools = registry.listTools()

  if (toolNames && toolNames.length > 0) {
    const nameSet = new Set(toolNames)
    const filtered: Record<string, Record<string, any>> = {}
    for (const [name, info] of Object.entries(allTools)) {
      if (nameSet.has(name)) {
        filtered[name] = info
      }
    }
    allTools = filtered
  }

  const lcTools: StructuredTool[] = []
  for (const toolName of Object.keys(allTools)) {
    const moduTool = registry.getTool(toolName)
    if (!moduTool) {
      logger.warning("Tool '%s' not found in registry, skipping", toolName)
      continue
    }
    try {
      lcTools.push(wrap_modu_tool(moduTool, config))
    } catch (e: any) {
      logger.error("Failed to wrap tool '%s': %s", toolName, String(e))
    }
  }

  logger.info(
    'Built %d LangChain tools: %s',
    lcTools.length,
    lcTools.map((t) => t.name),
  )
  return lcTools
}
