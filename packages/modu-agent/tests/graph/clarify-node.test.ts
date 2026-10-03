// 需求澄清（HITL clarifying）测试
//
// 覆盖两层：
//   1. assessClarificationNeed —— 确定性判定（开关/轮次上限/短输入/模糊短语）
//   2. clarify 节点 e2e —— interrupt(kind='clarifying') 暂停 → resume(answer)
//      写入 clarification_answers 并把澄清内容注入 messages 后继续执行
//
// 设计约束：perception.clarification.enabled 默认 false，关闭时图不挂 clarify 节点、
// 路由不分叉，行为与现状逐字节等价（本文件最后一个用例锁定该约束）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { assessClarificationNeed, makeClarifyNode } from '@/graph/nodes.js'
import { overrideConfig, resetConfig, RuntimeConfig } from '@/config/runtime-config.js'
import { checkInterruptTimeout, get_interrupt_state, resume_sync } from '@/graph/runner.js'
import type { ModuAgentState } from '@/graph/state.js'

/** 始终返回同一段终答的 mock LLM */
class StaticMockLlm {
  public lastMessages: any[] = []

  async invoke(messages: any[]): Promise<any> {
    this.lastMessages = messages
    return new AIMessage({ content: '已根据补充信息完成回答。' })
  }

  bindTools(_tools: any[]): any {
    return this
  }

  bind(_opts: any): any {
    return this
  }
}

const CLARIFY_CONFIG = {
  perception: {
    clarification: {
      enabled: true,
      max_clarify_rounds: 2,
      min_input_chars: 10,
      insufficient_patterns: ['帮我弄一下'],
      question_template: '你的需求还不太明确，方便补充一下具体想做什么吗？',
      default_options: [{ id: 'doc', label: '生成文档' }],
    },
  },
}

function makeState(threadId: string, prompt: string): Partial<ModuAgentState> {
  return {
    input_data: { prompt, input_type: 'text' },
    cleaned_text: prompt,
    session_id: threadId,
    user_id: 'test-user',
    trace_id: `trace-${threadId}`,
  }
}

describe('assessClarificationNeed —— 需求明确度判定', () => {
  const baseState = (over: Partial<ModuAgentState> = {}): ModuAgentState =>
    ({ cleaned_text: '请帮我生成一份 2026 年第三季度的销售总结文档，需要包含图表', ...over }) as ModuAgentState

  it('开关关闭时永不澄清（零侵入）', () => {
    const d = assessClarificationNeed(baseState({ cleaned_text: '短' }), { enabled: false })
    expect(d.needed).toBe(false)
    expect(d.reason).toBe('disabled')
  })

  it('输入过短时触发澄清', () => {
    const d = assessClarificationNeed(baseState({ cleaned_text: '帮我做' }), {
      enabled: true,
      min_input_chars: 10,
    })
    expect(d.needed).toBe(true)
    expect(d.reason).toBe('input_too_short')
  })

  it('命中模糊短语时触发澄清', () => {
    const d = assessClarificationNeed(baseState({ cleaned_text: '帮我弄一下这个东西吧' }), {
      enabled: true,
      min_input_chars: 2,
      insufficient_patterns: ['帮我弄一下'],
    })
    expect(d.needed).toBe(true)
    expect(d.reason).toContain('insufficient_pattern')
  })

  it('信息充分时不澄清', () => {
    const d = assessClarificationNeed(baseState(), { enabled: true, min_input_chars: 10 })
    expect(d.needed).toBe(false)
    expect(d.reason).toBe('sufficient')
  })

  it('达到澄清轮次上限后不再追问（防死循环）', () => {
    const d = assessClarificationNeed(baseState({ cleaned_text: '短', clarification_round: 2 }), {
      enabled: true,
      min_input_chars: 10,
      max_clarify_rounds: 2,
    })
    expect(d.needed).toBe(false)
    expect(d.reason).toBe('round_limit_reached')
  })

  it('澄清选项来自配置（供 choice 弹窗渲染）', () => {
    const d = assessClarificationNeed(baseState({ cleaned_text: '帮我弄一下' }), {
      enabled: true,
      min_input_chars: 2,
      insufficient_patterns: ['帮我弄一下'],
      default_options: [{ id: 'doc', label: '生成文档' }],
    })
    expect(d.needed).toBe(true)
    expect(d.options).toEqual([{ id: 'doc', label: '生成文档' }])
  })
})

describe('clarify 节点 e2e：澄清暂停与恢复', () => {
  let restoreHandle: { restore: () => void } | null = null

  afterEach(() => {
    if (restoreHandle) {
      restoreHandle.restore()
      restoreHandle = null
    }
    resetConfig()
  })

  function overrideClarify(extra: Record<string, any> = {}): void {
    restoreHandle = overrideConfig(new RuntimeConfig({
      perception: {
        clarification: {
          ...CLARIFY_CONFIG.perception.clarification,
          ...extra,
        },
      },
    }))
  }

  it('短输入触发 interrupt(kind=clarifying)，resume(answer) 后写入答案并继续执行', async () => {
    overrideClarify()
    const llm = new StaticMockLlm()
    const compiled = buildModuGraph(
      [],
      llm,
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      false, // HITL 工具审批关闭（本次只验证澄清）
      false,
      null,
      false,
      null,
      null,
      null,
    )

    const threadId = 'clarify-thread-1'
    await compiled.invoke(makeState(threadId, '帮我做'), {
      configurable: { thread_id: threadId },
    })

    // 1. 暂停在 clarify 节点，载荷完整（kind/question/options）
    const pending = await get_interrupt_state(compiled, threadId)
    expect(pending).not.toBeNull()
    expect(pending!.kind).toBe('choice')
    expect(pending!.next_nodes).toContain('clarify')
    expect(String(pending!.question ?? '').length).toBeGreaterThan(0)
    expect(Array.isArray(pending!.options)).toBe(true)
    expect(pending!.options.length).toBe(1)
    expect(pending!.session_id).toBe(threadId)

    // 2. 用户回答后恢复
    const result = await resume_sync(compiled, threadId, true, '', 'trace-clarify-1', {
      answer: '我想生成一份季度总结文档',
      answerId: 'doc',
    })
    expect(result.status).toBe('success')

    // 3. 澄清结果落状态：轮次 +1、答案可追溯
    const after = await compiled.getState({ configurable: { thread_id: threadId } })
    const values = after?.values ?? {}
    expect(values.clarification_round).toBe(1)
    const answers = values.clarification_answers ?? []
    expect(answers.length).toBe(1)
    expect(answers[0].answer).toContain('季度总结')

    // 4. 澄清后不再处于暂停态
    expect(await get_interrupt_state(compiled, threadId)).toBeNull()
  }, 30000)

  it('关闭开关时图不挂 clarify 节点，长输入零澄清直接回答', async () => {
    resetConfig()
    const llm = new StaticMockLlm()
    const compiled = buildModuGraph(
      [],
      llm,
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      false,
      false,
      null,
      false,
      null,
      null,
      null,
    )

    const threadId = 'clarify-thread-disabled'
    await compiled.invoke(makeState(threadId, '帮我做'), {
      configurable: { thread_id: threadId },
    })

    // 开关关闭 → 短输入也不会触发澄清
    expect(await get_interrupt_state(compiled, threadId)).toBeNull()
    const state = await compiled.getState({ configurable: { thread_id: threadId } })
    expect(state?.values?.clarification_round ?? 0).toBe(0)
  }, 30000)

  it('节点工厂在未命中判定时直接透传（不产生 interrupt）', async () => {
    overrideClarify({ min_input_chars: 2, insufficient_patterns: [] })
    const node = makeClarifyNode()
    const out = await node({
      cleaned_text: '请生成一份详细的季度销售总结文档，包含图表与结论',
      session_id: 's-1',
    } as ModuAgentState)
    expect(out.needs_clarification).toBe(false)
  })

  it('阶段1：超时恢复（timeout 标记）不消耗澄清轮次、不写入答案记录', async () => {
    overrideClarify()
    const llm = new StaticMockLlm()
    const compiled = buildModuGraph(
      [],
      llm,
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      false,
      false,
      null,
      false,
      null,
      null,
      null,
    )

    const threadId = 'clarify-timeout-thread'
    await compiled.invoke(makeState(threadId, '帮我做'), {
      configurable: { thread_id: threadId },
    })
    // 暂停在 clarify（配置了 default_options → kind='choice'）
    expect((await get_interrupt_state(compiled, threadId))?.kind).toBe('choice')

    // 模拟 runner.checkInterruptTimeout 在 on_timeout='continue_with_defaults' 下的恢复调用
    const result = await resume_sync(
      compiled,
      threadId,
      false,
      'clarify timed out after 120s, continuing with defaults',
      'trace-timeout-1',
      { timeout: true },
    )
    expect(result.status).toBe('success')

    const after = await compiled.getState({ configurable: { thread_id: threadId } })
    const values = after?.values ?? {}
    // 超时不消耗轮次、不写答案记录（用户回来后仍保有完整澄清机会）
    expect(values.clarification_round ?? 0).toBe(0)
    expect((values.clarification_answers ?? []).length).toBe(0)
    // 暂停解除，图已继续执行完毕
    expect(await get_interrupt_state(compiled, threadId)).toBeNull()
  }, 30000)

  it('阶段1：澄清超时读独立配置（timeout_seconds=0 禁用，不再复用工具审批 300s）', async () => {
    overrideClarify({ timeout_seconds: 0 })
    const llm = new StaticMockLlm()
    const compiled = buildModuGraph(
      [],
      llm,
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      false,
      false,
      null,
      false,
      null,
      null,
      null,
    )

    const threadId = 'clarify-timeout-config-thread'
    await compiled.invoke(makeState(threadId, '帮我做'), {
      configurable: { thread_id: threadId },
    })
    expect(await get_interrupt_state(compiled, threadId)).not.toBeNull()

    // 澄清超时被禁用 → no_config；若仍复用工具审批默认 300s 会返回 active（分流回归）
    expect(await checkInterruptTimeout(compiled, threadId)).toBe('no_config')
  }, 30000)
})
