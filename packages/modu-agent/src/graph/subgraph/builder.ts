// 对应 Python: modu_graph/subgraph/builder.py
// P3-12.3.1 子 Agent 子图构建器。
//
// 构建独立的编译子图（mini ReAct 循环），使用 SubAgentState 隔离。
// 子图可独立编译运行（避免嵌套递归消耗主图 recursion_limit，规避风险 R1），
// 也可作为参考实现供 make_subagent_node 复用核心逻辑。
//
// 子图结构：
//   START → sub_agent → [route] ── 有 tool_calls → sub_tools → sub_agent (循环)
//                             └── 无 tool_calls → sub_finalize → END
import type { BaseMessage } from '@langchain/core/messages'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { StructuredTool } from '@langchain/core/tools'
import { END, START, StateGraph, type CompiledStateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'

import { SubAgentStateAnnotation, type SubAgentState } from './states.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.subgraph.builder] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.subgraph.builder] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.subgraph.builder] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.subgraph.builder] ${msg}`, ...args),
}

// 子 Agent 默认系统提示词模板（按 task_type 区分）
const _SYSTEM_PROMPT_TEMPLATES: Record<string, string> = {
  research:
    'You are a Research Agent. Your task is to investigate and gather information ' +
    'about the given topic. Provide thorough, factual findings.',
  coding:
    'You are a Code Agent. Your task is to write, analyze, or review code ' +
    'for the given requirement. Provide clear, correct implementations.',
  review:
    'You are a Review Agent. Your task is to review and evaluate the given content ' +
    'for quality, correctness, and completeness. Provide constructive feedback.',
  default:
    'You are a specialized Agent. Complete the assigned subtask accurately and concisely.',
}

/**
 * 根据 task_type 获取系统提示词。
 *
 * P1 外置：当未传入 customPrompt 时，优先从配置 `agents.<task_type>.prompt`
 * 读取覆盖模板；配置缺失/关闭时才回退到内置硬编码模板。
 *
 * 行为等价性：customPrompt 优先级不变；不传 config（或 config 中无
 * `agents.<task_type>.prompt`）时，返回结果与改造前完全一致。
 *
 * @param taskType 子任务类型（research/coding/review/default）
 * @param customPrompt 显式传入的提示词（优先级最高）
 * @param config 可选运行时配置，用于读取 agents.<task_type>.prompt 覆盖模板
 */
export function _getSystemPrompt(
  taskType: string,
  customPrompt?: string | null,
  config?: import('../../config/runtime-config.js').RuntimeConfig | null,
): string {
  if (customPrompt) {
    return customPrompt
  }
  // P1 外置：配置覆盖默认模板（可选增强，默认无配置时等价现状）
  if (config) {
    const configured = config.get(`agents.${taskType}.prompt`, null)
    if (configured && typeof configured === 'string' && configured.trim() !== '') {
      return configured
    }
  }
  return _SYSTEM_PROMPT_TEMPLATES[taskType] || _SYSTEM_PROMPT_TEMPLATES.default
}

/** 子图内 ReAct 路由：有 tool_calls → sub_tools，无 → sub_finalize。 */
function _routeAfterSubAgent(state: SubAgentState): string {
  const messages = state.messages || []
  if (messages.length === 0) {
    return 'sub_finalize'
  }
  const lastMsg = messages[messages.length - 1] as any
  if (lastMsg.tool_calls && Array.isArray(lastMsg.tool_calls) && lastMsg.tool_calls.length > 0) {
    return 'sub_tools'
  }
  return 'sub_finalize'
}

/**
 * 构建子 Agent 独立编译子图。
 *
 * 使用 SubAgentState 实现状态隔离，避免污染主图 ModuAgentState.messages。
 * 子图拥有独立的 recursion_limit，不计入主图递归预算（规避风险 R1）。
 *
 * @param llm ChatModel 实例（已绑定或未绑定工具均可）
 * @param tools LangChain 工具列表（null 或空列表=无工具的纯推理子图）
 * @param systemPrompt 自定义系统提示词（null=按 task_type 选择默认模板）
 * @param taskType 子任务类型（research/coding/review/default）
 * @param recursionLimit 子图递归限制（默认 10，独立于主图）
 * @returns 编译后的子图 CompiledStateGraph 实例
 */
export function build_subagent_subgraph(
  llm: any,
  tools?: StructuredTool[] | null,
  systemPrompt?: string | null,
  taskType: string = 'default',
  recursionLimit: number = 10,
): CompiledStateGraph<any, any> {
  const effectiveTools = tools || []
  const boundLlm = llm
  const prompt = _getSystemPrompt(taskType, systemPrompt)

  // 注：同 graph.ts，LangGraph JS 的 StateGraph 类型系统无法追踪 addNode 注册的
  // 节点名，此处使用 any 绕过 addEdge/addConditionalEdges 的字面量类型限制。
  const graph: any = new StateGraph(SubAgentStateAnnotation)

  // --- 子图节点定义 ---

  /** 子 Agent 推理节点：调用 LLM 处理子任务。 */
  async function subAgentNode(state: SubAgentState): Promise<Record<string, any>> {
    const messages: BaseMessage[] = [...(state.messages || [])]

    // 若无消息，从 task_input 构建 HumanMessage
    if (messages.length === 0) {
      const taskInput = state.task_input || {}
      let promptText = taskInput.prompt || ''
      if (!promptText) {
        promptText = JSON.stringify(taskInput)
      }
      messages.push(new HumanMessage(promptText))
    }

    // 注入系统提示词
    if (messages.length === 0 || !(messages[0] instanceof SystemMessage)) {
      messages.unshift(new SystemMessage(prompt))
    }

    if (messages.length === 0) {
      return { task_output: { status: 'error', message: 'No input' } }
    }

    try {
      const response = await boundLlm.invoke(messages)
      return { messages: [response] }
    } catch (e: any) {
      logger.error(
        'Sub-agent LLM invoke failed (task_id=%s): %s',
        state.task_id || '',
        String(e),
      )
      return {
        error: String(e),
        task_output: { status: 'error', error: String(e) },
      }
    }
  }

  /** 子图终结节点：提取最终输出为 task_output。 */
  function subFinalizeNode(state: SubAgentState): Record<string, any> {
    const messages = state.messages || []
    let responseContent = ''
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg instanceof AIMessage && msg.content) {
        responseContent = msg.content as string
        break
      }
    }

    const taskId = state.task_id || ''
    const taskTypeVal = state.task_type || 'default'

    return {
      task_output: {
        task_id: taskId,
        task_type: taskTypeVal,
        status: 'success',
        content: responseContent,
      },
    }
  }

  /** 空工具节点（无工具时使用）。 */
  function _noopTools(_state: SubAgentState): Record<string, any> {
    return {}
  }

  // --- 添加节点 ---
  graph.addNode('sub_agent', subAgentNode)
  if (effectiveTools.length > 0) {
    graph.addNode('sub_tools', new ToolNode(effectiveTools))
  } else {
    graph.addNode('sub_tools', _noopTools)
  }
  graph.addNode('sub_finalize', subFinalizeNode)

  // --- 添加边 ---
  graph.addEdge(START, 'sub_agent')
  graph.addConditionalEdges('sub_agent', _routeAfterSubAgent, {
    sub_tools: 'sub_tools',
    sub_finalize: 'sub_finalize',
  })
  graph.addEdge('sub_tools', 'sub_agent')
  graph.addEdge('sub_finalize', END)

  const compiled = graph.compile()
  ;(compiled as any).recursionLimit = recursionLimit

  logger.info(
    'Subagent subgraph built: task_type=%s tools=%d recursion_limit=%d',
    taskType, effectiveTools.length, recursionLimit,
  )

  return compiled
}
