// T3 回归测试：plan-step TraceNode → 任务监控待办项映射
import { describe, it, expect } from 'vitest'
import type { TraceNode } from '@shared/types'
import { planStepNodesToTodos } from '@/lib/trace-utils'

function planNode(partial: Partial<TraceNode>): TraceNode {
  return {
    id: 'n',
    kind: 'plan-step',
    label: '步骤',
    status: 'pending',
    parentId: null,
    children: [],
    ...partial
  }
}

describe('planStepNodesToTodos（T3）', () => {
  it('标题取 label，completed 状态映射为已完成', () => {
    const todos = planStepNodesToTodos([
      planNode({ id: 's1', label: '搜集资料', status: 'completed' }),
      planNode({ id: 's2', label: '撰写文档', status: 'running' }),
      planNode({ id: 's3', label: '校对发布', status: 'pending' }),
      planNode({ id: 's4', label: '失败步骤', status: 'error' })
    ])
    expect(todos).toHaveLength(4)
    expect(todos[0]).toEqual({ id: 's1', text: '搜集资料', completed: true })
    expect(todos[1]!.completed).toBe(false)
    expect(todos[2]!.completed).toBe(false)
    expect(todos[3]!.completed).toBe(false)
  })

  it('label 缺省时回退 content，再缺省用兜底文案', () => {
    const todos = planStepNodesToTodos([
      planNode({ id: 's1', label: '', content: '来自 content 的描述' }),
      planNode({ id: 's2', label: '', content: '' })
    ])
    expect(todos[0]!.text).toBe('来自 content 的描述')
    expect(todos[1]!.text).toBe('计划步骤')
  })

  it('过滤非 plan-step 节点、忽略 undefined，并按 id 去重且保持顺序', () => {
    const todos = planStepNodesToTodos([
      planNode({ id: 'a', status: 'completed' }),
      undefined,
      planNode({ id: 'b', label: '工具调用', kind: 'tool-call' } as TraceNode),
      planNode({ id: 'a', label: '重复步骤', status: 'running' })
    ])
    expect(todos).toHaveLength(1)
    expect(todos[0]!.id).toBe('a')
    // 去重保留首次出现的状态（已完成）
    expect(todos[0]!.completed).toBe(true)
  })

  it('空输入返回空数组（普通 react_agent 会话走「暂无待办项」空态）', () => {
    expect(planStepNodesToTodos([])).toEqual([])
  })
})
