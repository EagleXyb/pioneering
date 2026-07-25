// 对应文档 §4.4 建议1/4/5：Supervisor 任务拆分单元测试
import { describe, expect, it } from 'vitest'

import {
  decompose_task,
  decompose_task_with_llm,
  make_supervisor_node,
  route_from_supervisor,
} from '../../../src/graph/subgraph/supervisor.js'
import type { ModuAgentState } from '../../../src/graph/state.js'

function _makeState(overrides: Partial<ModuAgentState> = {}): ModuAgentState {
  return {
    input_data: { prompt: 'Build a web app for weather' },
    cleaned_text: 'Build a web app for weather',
    trace_id: 'test-trace',
    session_id: 'test-session',
    user_id: 'test-user',
    subtasks: [],
    subtask_results: {},
    ...overrides,
  } as ModuAgentState
}

describe('decompose_task', () => {
  it('规则化拆分按 task_types 生成子任务', () => {
    const state = _makeState()
    const subtasks = decompose_task(state, 3, ['research', 'coding', 'review'])
    expect(subtasks.length).toBe(3)
    expect(subtasks[0].task_type).toBe('research')
    expect(subtasks[1].task_type).toBe('coding')
    expect(subtasks[2].task_type).toBe('review')
  })

  it('限制子任务数不超过 max_subagents', () => {
    const state = _makeState()
    const subtasks = decompose_task(state, 2, ['research', 'coding', 'review'])
    expect(subtasks.length).toBe(2)
  })

  it('每个子任务携带唯一 task_id', () => {
    const state = _makeState()
    const subtasks = decompose_task(state, 5)
    const taskIds = subtasks.map((t) => t.task_id)
    const uniqueIds = new Set(taskIds)
    expect(uniqueIds.size).toBe(taskIds.length)
  })

  it('所有子任务共享相同 prompt（v1.3 行为）', () => {
    const state = _makeState()
    const subtasks = decompose_task(state, 3)
    const prompts = subtasks.map((t) => t.task_input?.prompt)
    expect(prompts.every((p) => p === prompts[0])).toBe(true)
  })
})

describe('decompose_task_with_llm', () => {
  it('llm 为空时 fallback 到规则化拆分', async () => {
    const state = _makeState()
    const subtasks = await decompose_task_with_llm(state, null, 3)
    expect(subtasks.length).toBe(3)
    // 规则化拆分的所有 prompt 相同
    const prompts = subtasks.map((t) => t.task_input?.prompt)
    expect(prompts.every((p) => p === prompts[0])).toBe(true)
  })

  it('v1.4 §4.4 建议1：LLM 驱动拆分生成具体子任务描述', async () => {
    const mockLlm = {
      invoke: async () => ({
        content: JSON.stringify([
          { task_type: 'research', description: '调研天气 API', depends_on: [] },
          { task_type: 'coding', description: '实现前端界面', depends_on: ['research_xxx'] },
        ]),
      }),
    }
    const state = _makeState()
    const subtasks = await decompose_task_with_llm(state, mockLlm, 5)
    expect(subtasks.length).toBe(2)
    // LLM 拆分的 prompt 应为具体子任务描述（与原始 prompt 不同）
    expect(subtasks[0].task_input?.prompt).toBe('调研天气 API')
    expect(subtasks[1].task_input?.prompt).toBe('实现前端界面')
    // depends_on 应被透传
    expect(Array.isArray(subtasks[1].depends_on)).toBe(true)
  })

  it('LLM 返回无效 JSON 时 fallback 到规则化', async () => {
    const mockLlm = {
      invoke: async () => ({ content: 'not a json array' }),
    }
    const state = _makeState()
    const subtasks = await decompose_task_with_llm(state, mockLlm, 3)
    expect(subtasks.length).toBe(3)
    // fallback 后所有 prompt 相同（规则化行为）
    const prompts = subtasks.map((t) => t.task_input?.prompt)
    expect(prompts.every((p) => p === prompts[0])).toBe(true)
  })
})

describe('make_supervisor_node', () => {
  it('无 plannerLlm 时使用规则化拆分', async () => {
    const nodeFn = make_supervisor_node(null, null, null)
    const state = _makeState()
    const result = await nodeFn(state)
    expect(result.subtasks.length).toBe(3)
    expect(result.subtask_results).toEqual({})
    expect(result.consensus_failed).toBe(false)
  })

  it('v1.4 §4.4 建议4：检测 need_help 信号触发重新拆分', async () => {
    const nodeFn = make_supervisor_node(null, null, null)
    const state = _makeState({
      subtasks: [
        { task_id: 'research_abc', task_type: 'research', task_input: {} },
        { task_id: 'coding_def', task_type: 'coding', task_input: {} },
      ],
      subtask_results: {
        research_abc: { status: 'success', output: 'done' },
        coding_def: { status: 'need_help', reason: 'need more info' },
      },
    })
    const result = await nodeFn(state)
    // 成功的 research_abc 应被保留
    expect(result.subtasks.some((t) => t.task_id === 'research_abc')).toBe(true)
    // 新拆分应产生子任务（替换 need_help 的 coding_def）
    expect(result.subtasks.length).toBeGreaterThanOrEqual(1)
  })
})

describe('route_from_supervisor', () => {
  it('无子任务时返回空数组', () => {
    const state = _makeState({ subtasks: [] })
    const sends = route_from_supervisor(state)
    expect(sends.length).toBe(0)
  })

  it('为每个无依赖子任务生成 Send', () => {
    const state = _makeState({
      subtasks: [
        { task_id: 't1', task_type: 'research', task_input: {}, depends_on: [] },
        { task_id: 't2', task_type: 'coding', task_input: {}, depends_on: [] },
      ],
    })
    const sends = route_from_supervisor(state)
    expect(sends.length).toBe(2)
  })

  it('v1.4 §4.4 建议1：依赖未完成的子任务不分发', () => {
    const state = _makeState({
      subtasks: [
        { task_id: 't1', task_type: 'research', task_input: {}, depends_on: [] },
        { task_id: 't2', task_type: 'coding', task_input: {}, depends_on: ['t1'] },
      ],
      subtask_results: {},
    })
    const sends = route_from_supervisor(state)
    // 仅 t1 无依赖，t2 依赖 t1 未完成
    expect(sends.length).toBe(1)
  })

  it('v1.4 §4.4 建议1：依赖已完成的子任务可分发', () => {
    const state = _makeState({
      subtasks: [
        { task_id: 't1', task_type: 'research', task_input: {}, depends_on: [] },
        { task_id: 't2', task_type: 'coding', task_input: {}, depends_on: ['t1'] },
      ],
      subtask_results: {
        t1: { status: 'success', output: 'research done' },
      },
    })
    const sends = route_from_supervisor(state)
    // t1 已完成跳过，t2 依赖已完成可分发
    expect(sends.length).toBe(1)
  })

  it('已完成的子任务不分发（避免重复执行）', () => {
    const state = _makeState({
      subtasks: [
        { task_id: 't1', task_type: 'research', task_input: {}, depends_on: [] },
        { task_id: 't2', task_type: 'coding', task_input: {}, depends_on: [] },
      ],
      subtask_results: {
        t1: { status: 'success', output: 'done' },
      },
    })
    const sends = route_from_supervisor(state)
    // 仅 t2 未完成
    expect(sends.length).toBe(1)
  })
})
