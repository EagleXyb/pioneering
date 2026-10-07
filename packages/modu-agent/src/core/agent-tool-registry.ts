/**
 * Agent 工具注册策略（T4.1）
 *
 * 面向宿主（如 backend-ts）的精简工具注册门面：宿主在启动时（create_agent 之前）
 * 调用 registerAgentTool 注入额外工具；create_agent 经 ComponentRegistry 统一消费。
 *
 * 语义：
 *   - 同名重复注册：覆盖（后注册者为权威），不抛错
 *   - 注册 / 反注册均幂等
 *   - resetAgentToolRegistry 仅清理通过本门面注册项以外的组件不受影响
 */
import { getRegistry } from './registry.js'
import type { BaseTool } from './interfaces/action.js'

/** 注册一个工具（同名覆盖），返回工具名 */
export function registerAgentTool(tool: BaseTool): string {
  if (!tool || typeof tool.name !== 'function') {
    throw new TypeError('registerAgentTool: tool must implement name()')
  }
  getRegistry().registerTool(tool)
  return tool.name()
}

/** 按名获取已注册工具 */
export function getAgentTool(name: string): BaseTool | undefined {
  return getRegistry().getTool(name)
}

/** 列出当前已注册工具名（注册顺序） */
export function listAgentTools(): string[] {
  return Object.keys(getRegistry().listTools())
}

/** 按名移除工具；不存在返回 false */
export function unregisterAgentTool(name: string): boolean {
  return getRegistry().unregisterTool(name)
}
