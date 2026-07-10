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
  const toolDesc = moduTool.description()
  const schema = moduTool.parametersSchema()

  const argsSchema = _schema_to_zod(`${toolName}_schema`, schema)

  // 同步/异步调用 ModuAgent 工具，返回 JSON 字符串结果
  const func = async (input: Record<string, any>): Promise<string> => {
    const result = await moduTool.invoke(input, {})
    return JSON.stringify(result)
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
