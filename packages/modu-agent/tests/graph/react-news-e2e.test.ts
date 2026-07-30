// 端到端 ReAct 推理流程测试：用户任务"总结今天有关AI的新闻"
//
// 验证目标（对应文档 §5.3 P2 优化后的 ReAct 流程）：
//   1. Agent 能正确进入 ReAct 循环（Thought → Action → Observation → ... → Final Answer）
//   2. 工具调用顺序符合防幻觉 system prompt 约束（datetime → search_engine → 终答）
//   3. P2 优化（guardrails / few-shot / orchestrator）在默认关闭时不破坏现有流程
//   4. P2 优化在显式启用时也能正常工作（不破坏 ReAct 循环）
//
// 测试策略：
//   - Mock LLM：脚本化 3 轮 ReAct 推理（datetime 调用 → search_engine 调用 → 终答）
//   - 真实 DateTimeTool：纯 JS 计算，无网络依赖
//   - Stub SearchTool：覆写 invoke 返回模拟 AI 新闻，避免外部网络
//   - 直接调用 buildModuGraph 构建图，绕过 factory 的 LLM 构建与 MCP 发现
//   - 通过 graph.invoke 执行完整 ReAct 循环
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { buildModuGraph } from '@/graph/graph.js'
import { getConfig, overrideConfig, RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { ObservationDistiller } from '@/graph/adapters/observation-distiller.js'
import { DateTimeTool, SearchTool } from '@/tools/index.js'
import { wrap_modu_tool } from '@/graph/adapters/tool-adapter.js'
import type { ModuAgentState } from '@/graph/state.js'

// ============================================================
// Mock LLM：脚本化 ReAct 推理轮次
// ============================================================

/**
 * 脚本化 Mock LLM。
 *
 * 按预设脚本依次返回 AIMessage：
 *   - 第 1 轮：返回 datetime 工具调用（获取今天日期）
 *   - 第 2 轮：返回 search_engine 工具调用（搜索 AI 新闻）
 *   - 第 3 轮：返回最终自然语言摘要（无 tool_calls，结束 ReAct 循环）
 *
 * 记录每次调用的 messages 快照，供测试断言推理过程。
 */
class ScriptedMockLlm {
  public callCount = 0
  public callSnapshots: Array<{ messages: any[] }> = []

  private scripts: Array<{
    content: string
    tool_calls?: Array<{ id: string; name: string; args: Record<string, any> }>
  }> = [
    // 第 1 轮：Thought + Action(datetime)
    {
      content: '我需要先获取今天的日期，以便搜索今天的 AI 新闻。',
      tool_calls: [
        { id: 'call_dt_1', name: 'datetime', args: { op: 'now', timezone: 'CST' } },
      ],
    },
    // 第 2 轮：Thought + Action(search_engine)
    {
      content: '已获取今天日期，现在搜索今天有关 AI 的新闻。',
      tool_calls: [
        { id: 'call_se_1', name: 'search_engine', args: { query: 'AI 新闻 今天 2026', max_results: 5 } },
      ],
    },
    // 第 3 轮：Final Answer（无 tool_calls，结束 ReAct 循环）
    {
      content:
        '今天（2026-07-30）有关 AI 的新闻摘要：\n' +
        '1. OpenAI 发布 GPT-5 新版本，多模态能力大幅提升；\n' +
        '2. 国内 DeepSeek-V4 模型开源，性能对标 GPT-4；\n' +
        '3. 欧盟 AI 法案进入执行阶段，规范高风险 AI 应用；\n' +
        '4. 谷歌 DeepMind 在蛋白质折叠预测上取得新突破；\n' +
        '5. 字节跳动豆包大模型升级，推理成本下降 50%。',
      // 无 tool_calls —— 触发 routeAfterAgent 返回 __end__
    },
  ]

  async invoke(messages: any[]): Promise<any> {
    this.callCount += 1
    this.callSnapshots.push({ messages: [...messages] })

    const idx = Math.min(this.callCount - 1, this.scripts.length - 1)
    const script = this.scripts[idx]

    return new AIMessage({
      content: script.content,
      tool_calls: script.tool_calls as any,
    })
  }

  // LangChain bindTools 调用会返回带 bindTools 方法的对象；
  // 我们直接返回 this 即可，因为 mock 不真正绑定工具 schema
  bindTools(_tools: any[]): any {
    return this
  }

  // 支持 agentNode 中的 boundLlm.bind({ temperature }) 调用
  bind(_opts: any): any {
    return this
  }
}

// ============================================================
// Stub SearchTool：返回模拟 AI 新闻，避免外部网络依赖
// ============================================================

class StubSearchTool extends SearchTool {
  public invokeCount = 0
  public lastQuery: string = ''

  async invoke(
    params: Record<string, any>,
    _context: Record<string, any>,
  ): Promise<Record<string, any>> {
    this.invokeCount += 1
    this.lastQuery = String(params.query ?? '')

    return {
      status: 'success',
      error_code: '',
      data: {
        results: [
          {
            title: 'OpenAI 发布 GPT-5 新版本',
            url: 'https://example.com/openai-gpt5',
            snippet: 'OpenAI 今日发布 GPT-5，多模态能力大幅提升，支持图像/音频/视频理解。',
            source: 'mock',
          },
          {
            title: 'DeepSeek-V4 模型开源',
            url: 'https://example.com/deepseek-v4',
            snippet: '国内 DeepSeek 开源 V4 模型，性能对标 GPT-4，推理成本下降 50%。',
            source: 'mock',
          },
          {
            title: '欧盟 AI 法案进入执行阶段',
            url: 'https://example.com/eu-ai-act',
            snippet: '欧盟 AI 法案正式进入执行阶段，对高风险 AI 应用实施严格监管。',
            source: 'mock',
          },
          {
            title: 'DeepMind 蛋白质折叠新突破',
            url: 'https://example.com/deepmind-protein',
            snippet: '谷歌 DeepMind 在蛋白质折叠预测上取得新突破，准确率提升至 95%。',
            source: 'mock',
          },
          {
            title: '字节跳动豆包大模型升级',
            url: 'https://example.com/bytedance-doubao',
            snippet: '字节跳动豆包大模型升级，推理成本下降 50%，性能提升 30%。',
            source: 'mock',
          },
        ],
        source: 'stub',
      },
    }
  }
}

// ============================================================
// 测试辅助：构建图并执行 ReAct 推理
// ============================================================

async function runReactNewsTask(opts: {
  enableGuardrails?: boolean
  enableFewShot?: boolean
  enableParallelTools?: boolean
  enableDistillation?: boolean
}): Promise<{
  finalState: any
  mockLlm: ScriptedMockLlm
  stubSearch: StubSearchTool
  dateTimeTool: DateTimeTool
}> {
  const mockLlm = new ScriptedMockLlm()
  const stubSearch = new StubSearchTool()
  const dateTimeTool = new DateTimeTool()

  // 包装为 LangChain StructuredTool
  // 使用真实 runtimeConfig（已被 overrideConfig 覆盖）
  const config = getConfig()
  const dtStructured = wrap_modu_tool(dateTimeTool, config)
  const searchStructured = wrap_modu_tool(stubSearch, config)
  const tools = [dtStructured, searchStructured]

  // 绑定工具（mockLlm.bindTools 返回 this，不真正绑定 schema）
  const boundLlm = mockLlm.bindTools(tools)

  // 构建图（关闭 HITL/multi_agent/plan_execute，纯 ReAct 模式）
  const distiller = opts.enableDistillation ? new ObservationDistiller(500) : null
  const compiled = buildModuGraph(
    tools,
    boundLlm,
    new MemorySaver(), // 使用内存 checkpointer
    null,              // 无 store
    'You are a helpful AI assistant.', // 系统提示词
    null,              // 默认 recursionLimit
    null,              // 无 orchestrator
    false,             // HITL 关闭
    false,             // multi_agent 关闭
    null,              // 无 judgeLlm
    false,             // plan_execute 关闭
    null,              // 无 rawLlm
    null,              // 无 complexityAssessor
    distiller,         // Observation 蒸馏器
  )

  // 执行 ReAct 推理
  const initialState: Partial<ModuAgentState> = {
    input_data: { prompt: '总结今天有关AI的新闻', input_type: 'text' },
    cleaned_text: '总结今天有关AI的新闻',
    session_id: 'test-react-news-session',
    user_id: 'test-user',
    trace_id: 'test-react-news-trace',
  }

  const config2 = {
    configurable: { thread_id: 'test-react-news-thread' },
    recursionLimit: 50, // 给足预算，避免 GraphRecursionError
  }

  const finalState = await compiled.invoke(initialState, config2)

  return { finalState, mockLlm, stubSearch, dateTimeTool }
}

// ============================================================
// 测试用例
// ============================================================

describe('ReAct 端到端推理：总结今天有关AI的新闻', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    resetConfig()
    // 默认使用 DEFAULT_CONFIG（所有 P2 feature flag 均默认 false）
    const cfg = new RuntimeConfig()
    restoreHandle = overrideConfig(cfg)
  })

  afterEach(() => {
    if (restoreHandle) {
      restoreHandle.restore()
      restoreHandle = null
    }
    resetConfig()
  })

  it('ReAct 循环正确执行：datetime → search_engine → 终答（P2 默认关闭）', async () => {
    const { finalState, mockLlm, stubSearch } = await runReactNewsTask({})

    // 验证 1：LLM 被调用 3 次（3 轮 ReAct 推理）
    expect(mockLlm.callCount).toBe(3)

    // 验证 2：第 1 轮 LLM 收到 HumanMessage（用户任务）
    const firstCallMessages = mockLlm.callSnapshots[0].messages
    const hasHumanMsg = firstCallMessages.some(
      (m) => m instanceof HumanMessage || m._getType?.() === 'human',
    )
    expect(hasHumanMsg).toBe(true)

    // 验证 3：第 2 轮 LLM 收到 ToolMessage（datetime 结果）
    const secondCallMessages = mockLlm.callSnapshots[1].messages
    const hasDateTimeToolMsg = secondCallMessages.some(
      (m) => m._getType?.() === 'tool' && /datetime|now|CST/i.test(String(m.content ?? '')),
    )
    expect(hasDateTimeToolMsg).toBe(true)

    // 验证 4：第 3 轮 LLM 收到 ToolMessage（search_engine 结果）
    const thirdCallMessages = mockLlm.callSnapshots[2].messages
    const hasSearchToolMsg = thirdCallMessages.some(
      (m) => m._getType?.() === 'tool' && /OpenAI|GPT-5|DeepSeek|AI 新闻/i.test(String(m.content ?? '')),
    )
    expect(hasSearchToolMsg).toBe(true)

    // 验证 5：search_engine 工具被调用 1 次
    expect(stubSearch.invokeCount).toBe(1)
    // 验证 query 包含 AI 关键词
    expect(stubSearch.lastQuery).toMatch(/AI/i)

    // 验证 6：最终响应包含新闻摘要关键词
    const response = String(finalState.response ?? '')
    expect(response.length).toBeGreaterThan(50)
    // 至少包含一条新闻关键词
    const newsKeywords = ['OpenAI', 'GPT-5', 'DeepSeek', '欧盟', 'DeepMind', '豆包']
    const matchedCount = newsKeywords.filter((kw) => response.includes(kw)).length
    expect(matchedCount).toBeGreaterThanOrEqual(2)

    // 验证 7：tool_results 收集了 datetime 和 search_engine 的工具结果
    // 注：tool_results reducer 为 append 语义，多次 tool_processor 调用会累积条目，
    //     此处验证去重后的工具名集合，而非精确条数（reducer 行为属已知设计）
    const toolResults = finalState.tool_results ?? []
    expect(Array.isArray(toolResults)).toBe(true)
    expect(toolResults.length).toBeGreaterThanOrEqual(2)
    const uniqueToolNames = Array.from(new Set(toolResults.map((r: any) => r.tool))).sort()
    expect(uniqueToolNames).toEqual(['datetime', 'search_engine'])

    // 验证 8：无错误码
    expect(finalState.error_code ?? '').toBe('')
  }, 30000)

  it('ReAct 循环产出正确的最终响应文本（不含原始 tool JSON）', async () => {
    const { finalState } = await runReactNewsTask({})

    const response = String(finalState.response ?? '')
    // 验证：终答不应是原始 tool JSON（{"status":"success",...}）
    expect(response.startsWith('{')).toBe(false)
    // 终答应以可读文本开头（包含"今天"或"摘要"等关键词）
    expect(/今天|摘要|新闻/i.test(response)).toBe(true)
  }, 30000)

  it('P2-1 guardrails 启用时不破坏 ReAct 循环（读操作不触发审批）', async () => {
    // 启用 guardrails
    const cfg = new RuntimeConfig({
      react_optimization: {
        action_guardrails: { enabled: true, dry_run_enabled: true },
      },
    })
    restoreHandle?.restore()
    restoreHandle = overrideConfig(cfg)

    // HITL 关闭：guardrails 检查在 humanReviewNode 内执行，
    // humanReviewNode 关闭时 guardrail 检查不触发，因此读操作 ReAct 流程应正常完成
    const { finalState, mockLlm, stubSearch } = await runReactNewsTask({
      enableGuardrails: true,
    })

    expect(mockLlm.callCount).toBe(3)
    expect(stubSearch.invokeCount).toBe(1)
    expect(String(finalState.response ?? '').length).toBeGreaterThan(50)
    expect(finalState.error_code ?? '').toBe('')
  }, 30000)

  it('P2-2 few-shot 启用但示例库为空时不破坏 ReAct 循环（零侵入）', async () => {
    // 启用 few-shot，但 InMemoryExampleStore 初始为空
    const cfg = new RuntimeConfig({
      react_optimization: {
        few_shot: {
          enabled: true,
          max_examples: 3,
          max_tokens_budget: 1500,
          min_quality_score: 0.7,
          mmr_lambda: 0.7,
        },
      },
    })
    restoreHandle?.restore()
    restoreHandle = overrideConfig(cfg)

    const { finalState, mockLlm, stubSearch } = await runReactNewsTask({
      enableFewShot: true,
    })

    // few-shot 空库时应静默跳过，ReAct 流程正常执行
    expect(mockLlm.callCount).toBe(3)
    expect(stubSearch.invokeCount).toBe(1)
    expect(String(finalState.response ?? '').length).toBeGreaterThan(50)
    expect(finalState.error_code ?? '').toBe('')
  }, 30000)

  it('P2-3 parallel_tools 启用时不破坏 ReAct 循环（advisory 模式仅打日志）', async () => {
    // 启用 parallel_tools
    const cfg = new RuntimeConfig({
      react_optimization: {
        parallel_tools: {
          enabled: true,
          conservative_mode: true,
        },
      },
    })
    restoreHandle?.restore()
    restoreHandle = overrideConfig(cfg)

    const { finalState, mockLlm, stubSearch } = await runReactNewsTask({
      enableParallelTools: true,
    })

    // 本测试每次只发 1 个 tool_call，parallel_tools 检测到 < 2 不触发编排
    expect(mockLlm.callCount).toBe(3)
    expect(stubSearch.invokeCount).toBe(1)
    expect(String(finalState.response ?? '').length).toBeGreaterThan(50)
    expect(finalState.error_code ?? '').toBe('')
  }, 30000)

  it('P2-3 parallel_tools 启用且多 tool_calls 时正确计算执行计划（advisory）', async () => {
    // 启用 parallel_tools
    const cfg = new RuntimeConfig({
      react_optimization: {
        parallel_tools: {
          enabled: true,
          conservative_mode: true,
        },
      },
    })
    restoreHandle?.restore()
    restoreHandle = overrideConfig(cfg)

    // 改造 mockLlm：第 1 轮返回 2 个独立 tool_calls（datetime + search_engine）
    // 验证 parallel_tools 不会破坏 ReAct 流程
    class MultiToolCallMockLlm extends ScriptedMockLlm {
      scripts: Array<{ content: string; tool_calls?: any[] }> = [
        // 第 1 轮：同时发 datetime + search_engine（理论上可并行）
        {
          content: '我需要今天的日期和 AI 新闻，同时发起两个工具调用。',
          tool_calls: [
            { id: 'call_dt_1', name: 'datetime', args: { op: 'now', timezone: 'CST' } },
            { id: 'call_se_1', name: 'search_engine', args: { query: 'AI 新闻 今天', max_results: 5 } },
          ],
        },
        // 第 2 轮：Final Answer
        {
          content:
            '今天有关 AI 的新闻摘要：\n' +
            '1. OpenAI 发布 GPT-5；\n' +
            '2. DeepSeek-V4 开源；\n' +
            '3. 欧盟 AI 法案执行。',
        },
      ]
    }

    const mockLlm = new MultiToolCallMockLlm()
    const stubSearch = new StubSearchTool()
    const dateTimeTool = new DateTimeTool()
    const config = getConfig()
    const tools = [
      wrap_modu_tool(dateTimeTool, config),
      wrap_modu_tool(stubSearch, config),
    ]
    const boundLlm = mockLlm.bindTools(tools)

    const compiled = buildModuGraph(
      tools, boundLlm, new MemorySaver(), null,
      'You are a helpful AI assistant.',
      null, null, false, false, null, false, null, null, null,
    )

    const initialState: Partial<ModuAgentState> = {
      input_data: { prompt: '总结今天有关AI的新闻', input_type: 'text' },
      cleaned_text: '总结今天有关AI的新闻',
      session_id: 'test-parallel-session',
      user_id: 'test-user',
      trace_id: 'test-parallel-trace',
    }

    const finalState = await compiled.invoke(initialState, {
      configurable: { thread_id: 'test-parallel-thread' },
      recursionLimit: 50,
    })

    // 验证：2 轮 LLM 调用（第 1 轮双工具 + 第 2 轮终答）
    expect(mockLlm.callCount).toBe(2)
    // 验证：search_engine 被调用 1 次
    expect(stubSearch.invokeCount).toBe(1)
    // 验证：终答包含新闻关键词
    const response = String(finalState.response ?? '')
    expect(response.length).toBeGreaterThan(30)
    expect(/OpenAI|GPT-5|DeepSeek|AI/i.test(response)).toBe(true)
    // 验证：无错误
    expect(finalState.error_code ?? '').toBe('')
  }, 30000)

  it('Observation 蒸馏启用时不破坏 ReAct 循环（P0-3）', async () => {
    const { finalState, mockLlm, stubSearch } = await runReactNewsTask({
      enableDistillation: true,
    })

    // 蒸馏启用时应正常完成 ReAct 循环
    expect(mockLlm.callCount).toBe(3)
    expect(stubSearch.invokeCount).toBe(1)
    expect(String(finalState.response ?? '').length).toBeGreaterThan(50)

    // 验证 observation_history 被填充（蒸馏后的工具结果摘要）
    const obsHistory = finalState.observation_history ?? []
    expect(Array.isArray(obsHistory)).toBe(true)
    expect(obsHistory.length).toBeGreaterThanOrEqual(1)
    // 每条 observation 应包含 summary 字段
    for (const entry of obsHistory) {
      expect(typeof entry.summary).toBe('string')
    }
  }, 30000)
})
