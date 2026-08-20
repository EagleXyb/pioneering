// metrics 测试：三层指标组的计算逻辑（不依赖 LLM，rule 模式）
import { describe, expect, it } from 'vitest'
import {
  OutputMetricGroup,
  ProcessMetricGroup,
  SystemMetricGroup,
  toToolCallRecord,
} from '../src/metrics.js'
import type { AgentRunResult, EvalCase } from '../src/types.js'

function makeRun(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    caseId: 'test',
    ok: true,
    response: '好的回答',
    toolCalls: [],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    iteration: 1,
    reasoningRoundCount: 1,
    latencyMs: 1000,
    ...overrides,
  }
}

function makeCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'test',
    category: 'core',
    input: '测试问题',
    groundTruth: null,
    expectedTools: [],
    maxToolCalls: undefined,
    tags: [],
    source: 'human',
    ...overrides,
  }
}

const call = (tool: string, args: Record<string, any>, success = true) => ({
  toolName: tool,
  args,
  success,
})

// ============================================================
// 过程层
// ============================================================

describe('ProcessMetricGroup', () => {
  const group = new ProcessMetricGroup()

  it('无工具调用且无期望工具：success_rate/coverage=1', () => {
    const m = group.compute({ evalCase: makeCase(), agentRun: makeRun() })
    expect(m['process_tool_success_rate']).toBe(1)
    expect(m['process_tool_coverage']).toBe(1)
    expect(m['process_redundant_calls']).toBe(0)
    expect(m['process_recovery_rate']).toBe(1)
  })

  it('期望工具但未调用：success_rate=0, coverage=0', () => {
    const m = group.compute({
      evalCase: makeCase({ expectedTools: ['calculator'] }),
      agentRun: makeRun(),
    })
    expect(m['process_tool_success_rate']).toBe(0)
    expect(m['process_tool_coverage']).toBe(0)
  })

  it('工具成功率与覆盖率', () => {
    const m = group.compute({
      evalCase: makeCase({ expectedTools: ['calculator', 'search_engine'] }),
      agentRun: makeRun({
        toolCalls: [call('calculator', {}), call('calculator', {}, false)],
      }),
    })
    expect(m['process_tool_success_rate']).toBeCloseTo(0.5)
    expect(m['process_tool_coverage']).toBeCloseTo(0.5)
  })

  it('冗余调用：同工具同参数重复计冗余，换参数不算', () => {
    const m = group.compute({
      evalCase: makeCase(),
      agentRun: makeRun({
        toolCalls: [
          call('search', { q: 'a' }),
          call('search', { q: 'a' }),   // 冗余
          call('search', { q: 'b' }),   // 换参数，不算
        ],
      }),
    })
    expect(m['process_redundant_calls']).toBeCloseTo(1 / 3)
  })

  it('恢复率：失败后换参数重试=恢复，原样重试=未恢复', () => {
    const m = group.compute({
      evalCase: makeCase(),
      agentRun: makeRun({
        toolCalls: [
          call('search', { q: 'a' }, false),
          call('search', { q: 'b' }),   // 恢复
          call('calc', { e: '1+1' }, false),
          call('calc', { e: '1+1' }, false), // 原样重试，未恢复
        ],
      }),
    })
    expect(m['process_recovery_rate']).toBeCloseTo(0.5)
  })

  it('迭代效率：调用数超出预算线性衰减', () => {
    const m = group.compute({
      evalCase: makeCase({ maxToolCalls: 2 }),
      agentRun: makeRun({ toolCalls: [call('t', { i: 1 }), call('t', { i: 2 }), call('t', { i: 3 }), call('t', { i: 4 })] }),
    })
    // 4 calls / budget 2 -> 1 - (4-2)/2 = 0
    expect(m['process_iteration_efficiency']).toBe(0)
  })
})

// ============================================================
// 系统层
// ============================================================

describe('SystemMetricGroup', () => {
  const group = new SystemMetricGroup()

  it('ground_truth 子串命中 -> match=1 且 task_success=1', () => {
    const m = group.compute({
      evalCase: makeCase({ groundTruth: '4053' }),
      agentRun: makeRun({ response: '计算结果是 4053，希望对你有帮助。' }),
    })
    expect(m['system_ground_truth_match']).toBe(1)
    expect(m['system_task_success']).toBe(1)
  })

  it('ground_truth 语义相近 -> match ∈ (0,1)', () => {
    const m = group.compute({
      evalCase: makeCase({ groundTruth: 'ReAct 是一种让语言模型交替进行推理与行动的智能体范式' }),
      agentRun: makeRun({
        response: 'ReAct 是一种让大语言模型交替进行推理与行动的智能体范式，由推理和行动组成。',
      }),
    })
    expect(m['system_ground_truth_match']).toBeGreaterThan(0.3)
    expect(m['system_ground_truth_match']).toBeLessThanOrEqual(1)
  })

  it('无 gt 用例不产出 ground_truth_match，task_success 由 output 层代理', () => {
    const m = group.compute({
      evalCase: makeCase(),
      agentRun: makeRun(),
      outputMetrics: { output_relevance: 0.9 },
    })
    expect(m['system_ground_truth_match']).toBeUndefined()
    expect(m['system_task_success']).toBe(1)
  })

  it('执行失败（ok=false）-> task_success=0', () => {
    const m = group.compute({
      evalCase: makeCase(),
      agentRun: makeRun({ ok: false, errorCode: 'LLM_FAILED' }),
    })
    expect(m['system_task_success']).toBe(0)
  })
})

// ============================================================
// 输出层（rule 模式 QualityMonitor）
// ============================================================

describe('OutputMetricGroup（rule 模式）', () => {
  const group = new OutputMetricGroup()

  it('空响应 -> 四维全 0', async () => {
    const m = await group.compute({ evalCase: makeCase(), agentRun: makeRun({ response: '' }) })
    expect(m['output_relevance']).toBe(0)
    expect(m['output_completeness']).toBe(0)
  })

  it('正常回答产出四维指标', async () => {
    const m = await group.compute({
      evalCase: makeCase({ input: '计算 123 加 456 等于多少' }),
      agentRun: makeRun({ response: '123 加 456 等于 579。这是一个简单的加法运算。' }),
    })
    expect(m['output_relevance']).toBeGreaterThan(0)
    expect(m['output_completeness']).toBeGreaterThan(0)
    expect(m['output_confidence']).toBeGreaterThan(0)
  })
})

// ============================================================
// toToolCallRecord
// ============================================================

describe('toToolCallRecord', () => {
  it('映射 tool_results 元素（容错字段名）', () => {
    expect(
      toToolCallRecord({ tool_name: 'calc', args: { e: '1+1' }, success: true, execution_time: 12 }),
    ).toEqual({
      toolName: 'calc',
      args: { e: '1+1' },
      success: true,
      executionTimeMs: 12,
      error: null,
    })
    expect(toToolCallRecord({ tool: 'x', success: false }).toolName).toBe('x')
    expect(toToolCallRecord({ success: false }).toolName).toBe('unknown')
  })
})
