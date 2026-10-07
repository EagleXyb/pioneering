/**
 * 将持久化的 Agent contentBlocks 还原为 ProcessPanel 的 stateMap（T3.3）
 *
 * 块由后端 core/agent-bridge.collectMetadataFromEvent 收集：
 *   thinking / tool_call / tool_result / text_stream
 * 历史恢复后全部为 done 终态（无 running 脉冲）。
 */
import type { AgentStep } from './useAgentChat'

/** 后端持久化 contentBlocks 的松散结构 */
type PersistedBlock = {
  type?: string
  status?: string
  summary?: string
  text?: string
  toolName?: string
  executionId?: string
}

export function contentBlocksToSteps(
  blocks: unknown,
): Record<string, AgentStep> {
  if (!Array.isArray(blocks)) return {}

  const stateMap: Record<string, AgentStep> = {}
  let counter = 0

  for (const raw of blocks as PersistedBlock[]) {
    if (!raw || typeof raw !== 'object') continue

    if (raw.type === 'thinking') {
      counter += 1
      stateMap[`step_${counter}`] = {
        type: 'thinking',
        label: '深度思考',
        content: raw.summary ?? '',
        status: 'done',
      }
    } else if (raw.type === 'tool_call') {
      counter += 1
      stateMap[`step_${counter}`] = {
        type: 'tool_call',
        label: `调用工具 ${raw.toolName ?? ''}`,
        content: '',
        status: 'done',
      }
    } else if (raw.type === 'tool_result') {
      counter += 1
      stateMap[`step_${counter}`] = {
        type: 'tool_result',
        label: `工具结果: ${raw.toolName ?? ''}`,
        content: raw.summary ?? '',
        status: 'done',
      }
    }
    // text_stream 内容已在消息正文中，不重复展示
  }

  return stateMap
}
