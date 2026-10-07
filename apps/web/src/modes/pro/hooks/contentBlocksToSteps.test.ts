/**
 * contentBlocksToSteps 单元测试（T3.3）
 */
import { describe, it, expect } from 'vitest'
import { contentBlocksToSteps } from './contentBlocksToSteps'

describe('contentBlocksToSteps（T3.3）', () => {
  it('空/非法输入返回空 map', () => {
    expect(contentBlocksToSteps(null)).toEqual({})
    expect(contentBlocksToSteps('x')).toEqual({})
    expect(contentBlocksToSteps([{ foo: 1 }])).toEqual({})
  })

  it('thinking / tool_call / tool_result 顺序还原为 done 步骤', () => {
    const map = contentBlocksToSteps([
      { type: 'thinking', status: 'success', summary: '分析中' },
      { type: 'tool_call', status: 'success', toolName: 'search' },
      { type: 'tool_result', status: 'success', toolName: 'search', summary: '结果' },
      { type: 'text_stream', status: 'success', text: '正文' },
    ])

    const steps = Object.values(map)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatchObject({
      type: 'thinking',
      content: '分析中',
      status: 'done',
    })
    expect(steps[1]).toMatchObject({
      type: 'tool_call',
      label: '调用工具 search',
      status: 'done',
    })
    expect(steps[2]).toMatchObject({
      type: 'tool_result',
      label: '工具结果: search',
      content: '结果',
    })
  })

  it('text_stream 不生成步骤', () => {
    const map = contentBlocksToSteps([
      { type: 'text_stream', text: 'hello' },
    ])
    expect(Object.keys(map)).toHaveLength(0)
  })
})
