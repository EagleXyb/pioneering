import { describe, it, expect, afterEach } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'

import {
  DEFAULT_AGENT_CONTEXT_STRATEGY_ID,
  applyContextFragments,
  listFragmentIds,
} from '@/reasoning/context-builder.js'
import type { ContextRuntime, ContextStrategy } from '@/core/interfaces/context.js'
import {
  DEFAULT_AGENT_CONTEXT_FRAGMENTS,
  DefaultAgentContextStrategy,
  getDefaultAgentContextStrategy,
  registerBuiltinContextStrategies,
} from '@/graph/context-strategies.js'
import { renderPromptWithFallback } from '@/reasoning/prompt-registry.js'
import { DOC_GEN_TASK_PROMPT_TEMPLATE } from '@/graph/prompt-templates.js'
import { ComponentRegistry, resetRegistry } from '@/core/registry.js'
import { extractPerceptionContext } from '@/perception/index.js'

// ============================================================
// P2（T-15）ContextBuilder 测试
//
// 目标一：构建器语义（优先级 / 锚点偏移 / append / 异常隔离 / 预算 / 异步）
// 目标二：**等价矩阵** —— 迁移前 agentNode 内联 splice/push 算法（本文件内的
//         `legacyAssemble` 逐字复刻）与构建器输出在 256 种组合下逐字节一致
// ============================================================

/** 消息序列化（用于等价比较）。 */
function ser(messages: BaseMessage[]): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m._getType(), content: String(m.content) }))
}

interface AssembleInput {
  base: BaseMessage[]
  systemPrompt: string | null
  state: any
  fewShotPrompt?: string | null
  planMsg?: BaseMessage | null
}

/**
 * 迁移前 `agentNode`（graph/nodes.ts）上下文注入算法的逐字复刻。
 *
 * 唯一刻意保留的差异：文档生成提醒文本改为调用注册表（其文本本身已由
 * tests/reasoning/prompt-registry.test.ts 的 golden 断言锁定）。
 */
function legacyAssemble(input: AssembleInput): BaseMessage[] {
  const messages: BaseMessage[] = [...input.base]
  const effectiveSystemPrompt = input.systemPrompt

  // 注入系统提示词
  if (effectiveSystemPrompt && (messages.length === 0 || !(messages[0] instanceof SystemMessage))) {
    messages.unshift(new SystemMessage({ content: effectiveSystemPrompt }))
  }

  // 注入感知上下文
  const perceptionResult = input.state.perception_result
  if (perceptionResult) {
    const perceptionCtx = extractPerceptionContext(perceptionResult)
    if (perceptionCtx && Object.keys(perceptionCtx).length > 0) {
      const ctxMsg = new SystemMessage({
        content: `Perception context: ${JSON.stringify(perceptionCtx)}`,
      })
      const insertIdx = effectiveSystemPrompt ? 1 : 0
      messages.splice(insertIdx, 0, ctxMsg)
    }
  }

  // 注入任务类型上下文（文档生成任务专用强提醒）
  if (input.state.task_type === 'document_generation') {
    const docGenCtx = new SystemMessage({
      content: renderPromptWithFallback(
        'agent.doc_generation_task', {}, DOC_GEN_TASK_PROMPT_TEMPLATE,
      ),
    })
    const insertIdx = effectiveSystemPrompt ? 1 : 0
    messages.splice(insertIdx + 1, 0, docGenCtx)
  }

  // 注入长期知识
  const knowledge = input.state.knowledge ?? []
  if (knowledge.length > 0) {
    const knowledgeText = knowledge
      .filter((item: any) => item && typeof item === 'object')
      .map((item: any) => item['content'] ?? '')
      .join('\n')
    if (knowledgeText) {
      messages.splice(
        effectiveSystemPrompt ? 1 : 0,
        0,
        new SystemMessage({ content: `Relevant knowledge from memory:\n${knowledgeText}` }),
      )
    }
  }

  // 注入 Observation 蒸馏历史
  const observationHistory = input.state.observation_history ?? []
  if (observationHistory.length > 0) {
    const recentObs = observationHistory.slice(-5)
    const obsText = recentObs
      .map((o: any, idx: number) => {
        const summary = o['summary'] ?? ''
        const metrics = o['key_metrics'] ? ` | metrics: ${JSON.stringify(o['key_metrics'])}` : ''
        const count = o['records_count'] !== undefined ? ` | count: ${o['records_count']}` : ''
        const enhancement = o['enhancement'] ? `\n   ⚠️ ${o['enhancement']}` : ''
        return `[${idx}] ${o['tool'] ?? 'unknown'} (${o['status'] ?? 'success'}): ${summary}${count}${metrics}${enhancement}`
      })
      .join('\n')
    if (obsText) {
      messages.push(new SystemMessage({
        content: `Recent observations (distilled summaries):\n${obsText}`,
      }))
    }
  }

  // Few-shot
  if (input.fewShotPrompt) {
    messages.push(new SystemMessage({ content: input.fewShotPrompt }))
  }

  // plan 步骤上下文
  if (input.planMsg) {
    messages.push(input.planMsg)
  }

  return messages
}

/** 构建器路径（与被测 agentNode 的调用方式一致）。 */
async function builderAssemble(input: AssembleInput): Promise<BaseMessage[]> {
  const messages: BaseMessage[] = [...input.base]
  const effectiveSystemPrompt = input.systemPrompt
  if (effectiveSystemPrompt && (messages.length === 0 || !(messages[0] instanceof SystemMessage))) {
    messages.unshift(new SystemMessage({ content: effectiveSystemPrompt }))
  }
  const ctx: ContextRuntime = {
    anchorIndex: effectiveSystemPrompt ? 1 : 0,
    planContextInjector: input.planMsg ? () => input.planMsg! : null,
    fewShotSelector: input.fewShotPrompt
      ? { selectAndFormat: async () => input.fewShotPrompt! }
      : null,
  }
  return applyContextFragments(messages, input.state, ctx, getDefaultAgentContextStrategy())
}

describe('P2/T-15: ContextBuilder 语义', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('片段执行顺序：anchor 组（优先级升序）→ append 组（优先级升序）', () => {
    expect(listFragmentIds(new DefaultAgentContextStrategy())).toEqual([
      'ctx.perception',
      'ctx.doc_gen_task',
      'ctx.memory_knowledge',
      'ctx.observations',
      'ctx.few_shot',
      'ctx.plan_step',
    ])
  })

  it('空片段被跳过（不产生空 SystemMessage）', async () => {
    const messages = [new HumanMessage('hi')]
    await applyContextFragments(messages, {} as any, { anchorIndex: 0 }, getDefaultAgentContextStrategy())
    expect(ser(messages)).toEqual([{ role: 'human', content: 'hi' }])
  })

  it('片段异常被隔离（仅跳过该片段，其余片段照常注入）', async () => {
    const strategy: ContextStrategy = {
      id: 'test.error',
      supports: () => true,
      fragments: () => [
        { id: 'bad', priority: 1, placement: 'append', build: () => { throw new Error('boom') } },
        { id: 'good', priority: 2, placement: 'append', build: () => 'ok' },
      ],
    }
    const messages: BaseMessage[] = []
    await applyContextFragments(messages, {} as any, { anchorIndex: 0 }, strategy)
    expect(ser(messages)).toEqual([{ role: 'system', content: 'ok' }])
  })

  it('anchorOffset 与优先级共同决定插入位置', async () => {
    const strategy: ContextStrategy = {
      id: 'test.offset',
      supports: () => true,
      fragments: () => [
        { id: 'a', priority: 10, placement: 'anchor', anchorOffset: 0, build: () => 'A' },
        { id: 'b', priority: 20, placement: 'anchor', anchorOffset: 1, build: () => 'B' },
        { id: 'c', priority: 30, placement: 'anchor', anchorOffset: 0, build: () => 'C' },
        { id: 'd', priority: 40, placement: 'append', build: () => 'D' },
      ],
    }
    const messages: BaseMessage[] = [new SystemMessage('sys'), new HumanMessage('h')]
    await applyContextFragments(messages, {} as any, { anchorIndex: 1 }, strategy)
    expect(ser(messages)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'system', content: 'C' },
      { role: 'system', content: 'A' },
      { role: 'system', content: 'B' },
      { role: 'human', content: 'h' },
      { role: 'system', content: 'D' },
    ])
  })

  it('支持现成消息（planContextInjector）与异步片段（few-shot）', async () => {
    const planMsg = new SystemMessage('PLAN STEP')
    const strategy: ContextStrategy = {
      id: 'test.async',
      supports: () => true,
      fragments: () => [
        { id: 'few', priority: 1, placement: 'append', build: async () => 'ASYNC' },
        { id: 'plan', priority: 2, placement: 'append', build: () => planMsg },
      ],
    }
    const messages: BaseMessage[] = []
    await applyContextFragments(messages, {} as any, { anchorIndex: 0 }, strategy)
    expect(messages[0]).toBeInstanceOf(SystemMessage)
    expect(String(messages[0].content)).toBe('ASYNC')
    expect(messages[1]).toBe(planMsg)
  })

  it('budget 生效时按字符截断（默认不设置 = 不截断）', async () => {
    const strategy: ContextStrategy = {
      id: 'test.budget',
      supports: () => true,
      fragments: () => [
        { id: 'limited', priority: 1, placement: 'append', build: () => 'abcdefg', budget: 3 },
        { id: 'unlimited', priority: 2, placement: 'append', build: () => 'abcdefg' },
      ],
    }
    const messages: BaseMessage[] = []
    await applyContextFragments(messages, {} as any, { anchorIndex: 0 }, strategy)
    expect(String(messages[0].content)).toBe('abc')
    expect(String(messages[1].content)).toBe('abcdefg')
  })

  it('anchorIndex 为负数时钳制为 0（不被 splice 解释为"从末尾倒数"）', async () => {
    const strategy: ContextStrategy = {
      id: 'test.negative',
      supports: () => true,
      fragments: () => [
        { id: 'x', priority: 1, placement: 'anchor', anchorOffset: 0, build: () => 'X' },
      ],
    }
    const messages: BaseMessage[] = [new HumanMessage('h1'), new HumanMessage('h2')]
    await applyContextFragments(messages, {} as any, { anchorIndex: -1 }, strategy)
    expect(ser(messages)).toEqual([
      { role: 'system', content: 'X' },
      { role: 'human', content: 'h1' },
      { role: 'human', content: 'h2' },
    ])
  })

  it('anchorIndex 越界时按数组长度钳制（与 splice 语义一致）', async () => {
    const strategy: ContextStrategy = {
      id: 'test.clamp',
      supports: () => true,
      fragments: () => [
        { id: 'x', priority: 1, placement: 'anchor', anchorOffset: 5, build: () => 'X' },
      ],
    }
    const messages: BaseMessage[] = [new HumanMessage('h')]
    await applyContextFragments(messages, {} as any, { anchorIndex: 1 }, strategy)
    expect(ser(messages)).toEqual([
      { role: 'human', content: 'h' },
      { role: 'system', content: 'X' },
    ])
  })
})

describe('P2/T-15: 上下文策略注册表（ComponentRegistry 扩展）', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('注册 / 解析 / 默认策略 / 任务级命中', () => {
    const reg = new ComponentRegistry()
    registerBuiltinContextStrategies(reg)
    expect(reg.listContextStrategies()).toEqual([DEFAULT_AGENT_CONTEXT_STRATEGY_ID])
    expect(reg.getDefaultContextStrategyId()).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)

    // 无 taskType → 默认（内置）策略
    expect(reg.resolveContextStrategy(undefined)?.id).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)
    // taskType 非空但无任务级命中 → 回退默认策略（等价迁移前行为）
    expect(reg.resolveContextStrategy('document_generation')?.id).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)

    // 宿主任务级策略优先命中
    const custom: ContextStrategy = {
      id: 'host.docgen',
      supports: (t) => t === 'document_generation',
      fragments: () => [],
    }
    reg.registerContextStrategy(custom)
    expect(reg.resolveContextStrategy('document_generation')?.id).toBe('host.docgen')

    // 默认策略可被宿主替换
    reg.setDefaultContextStrategy('host.docgen')
    expect(reg.resolveContextStrategy(undefined)?.id).toBe('host.docgen')
    expect(() => reg.setDefaultContextStrategy('nope')).toThrow()
  })

  it('registerContextStrategy 拒绝非法策略', () => {
    const reg = new ComponentRegistry()
    expect(() => reg.registerContextStrategy({ id: '', supports: () => true, fragments: () => [] }))
      .toThrow(TypeError)
  })

  it('默认策略单例含全部内置片段，且 supports 语义正确', () => {
    const strategy = getDefaultAgentContextStrategy()
    expect(strategy.id).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)
    expect(strategy.fragments()).toBe(DEFAULT_AGENT_CONTEXT_FRAGMENTS)
    expect(strategy.supports(undefined)).toBe(true)
    expect(strategy.supports('document_generation')).toBe(false)
  })

  it('可注册自定义片段集合（不改 nodes.ts 即可扩展上下文）', async () => {
    const reg = new ComponentRegistry()
    const custom: ContextStrategy = {
      id: 'host.only',
      supports: () => true,
      fragments: () => [
        { id: 'host.frag', priority: 1, placement: 'append', build: () => 'HOST' },
      ],
    }
    reg.registerContextStrategy(custom, { makeDefault: true })
    const messages: BaseMessage[] = [new HumanMessage('h')]
    await applyContextFragments(
      messages, {} as any, { anchorIndex: 0 }, reg.resolveContextStrategy(undefined)!,
    )
    expect(ser(messages)).toEqual([
      { role: 'human', content: 'h' },
      { role: 'system', content: 'HOST' },
    ])
  })

  it('registerBuiltinContextStrategies 不顶掉宿主设置的默认策略（真实启动序列）', () => {
    const reg = new ComponentRegistry()
    reg.registerContextStrategy(
      { id: 'host.default', supports: () => true, fragments: () => [] },
      { makeDefault: true },
    )
    // 装配层（create_agent）随后注册内置策略
    registerBuiltinContextStrategies(reg)
    expect(reg.getDefaultContextStrategyId()).toBe('host.default')
    expect(reg.resolveContextStrategy(undefined)?.id).toBe('host.default')
    expect(reg.resolveContextStrategy('document_generation')?.id).toBe('host.default')
  })

  it('尚无默认策略时内置策略成为默认（首次装配）', () => {
    const reg = new ComponentRegistry()
    registerBuiltinContextStrategies(reg)
    expect(reg.getDefaultContextStrategyId()).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)
    // 重复调用不产生副作用
    registerBuiltinContextStrategies(reg)
    expect(reg.getDefaultContextStrategyId()).toBe(DEFAULT_AGENT_CONTEXT_STRATEGY_ID)
    expect(reg.listContextStrategies()).toEqual([DEFAULT_AGENT_CONTEXT_STRATEGY_ID])
  })

  it('既有 11 类组件契约未被破坏（listAll 不含新类别）', () => {
    const reg = new ComponentRegistry()
    registerBuiltinContextStrategies(reg)
    expect(Object.keys(reg.listAll()).length).toBe(11)
    expect(reg.swapComponent('unknown_category', 'x', {})).toBe(false)
  })
})

describe('P2/T-15: 等价矩阵（迁移前内联算法 ⇄ ContextBuilder）', () => {
  const PERCEPTION = {
    detected_language: 'zh',
    confidence: 0.9,
    intent: 'qa',
    metadata: { sensitivity_level: 0 },
  }
  const KNOWLEDGE = [{ content: 'k1' }, { content: 'k2' }]
  const OBSERVATIONS = [
    { tool: 'datetime', status: 'success', summary: 'now', records_count: 1 },
    { tool: 'search_engine', status: 'error', summary: 'fail', enhancement: 'retry with new query' },
  ]

  const BASE_VARIANTS: Array<{ name: string; base: BaseMessage[] }> = [
    { name: 'empty', base: [] },
    { name: 'human-only', base: [new HumanMessage('hi')] },
    { name: 'sys-preset', base: [new SystemMessage('preset'), new HumanMessage('hi')] },
    { name: 'multi', base: [new HumanMessage('h1'), new AIMessage('a1'), new HumanMessage('h2')] },
  ]

  it('7 开关 × 2 系统提示词 × 4 基线消息 = 1024 组合逐字节一致', async () => {
    let cases = 0
    for (const withSystem of [false, true]) {
      for (const variant of BASE_VARIANTS) {
        for (let mask = 0; mask < 128; mask++) {
          const state: any = {}
          if ((mask & 1) !== 0) state.perception_result = PERCEPTION
          if ((mask & 2) !== 0) state.task_type = 'document_generation'
          if ((mask & 4) !== 0) state.knowledge = KNOWLEDGE
          if ((mask & 8) !== 0) state.observation_history = OBSERVATIONS

          const input: AssembleInput = {
            base: variant.base,
            systemPrompt: withSystem ? 'SYS' : null,
            state,
            fewShotPrompt: (mask & 16) !== 0 ? 'FEWSHOT' : null,
            planMsg: (mask & 32) !== 0 ? new SystemMessage('PLAN') : null,
          }

          const legacy = ser(legacyAssemble(input))
          const built = ser(await builderAssemble(input))
          expect(built, `base=${variant.name} sys=${withSystem} mask=${mask}`).toEqual(legacy)
          cases += 1
        }
      }
    }
    expect(cases).toBe(1024)
  })
})
