// hitl-surface 单测（阶段4：HITL 展示通道决策）
import { describe, it, expect } from 'vitest'
import { resolveHitlSurface } from '../hitl-surface'
import type { UserQuestionRequestPayload } from '@shared/types'

const item = (kind: UserQuestionRequestPayload['kind'], sessionId = 's1') => ({
  kind,
  sessionId
})

describe('resolveHitlSurface —— HITL 展示通道决策（审批内嵌化后统一 inline）', () => {
  it('tool_confirm / clarifying / choice 一律 → inline', () => {
    expect(resolveHitlSurface(item('tool_confirm'), 'paused', 's1')).toBe('inline')
    expect(resolveHitlSurface(item('clarifying'), 'paused', 's1')).toBe('inline')
    expect(resolveHitlSurface(item('choice'), 'awaiting', 's1')).toBe('inline')
  })

  it('idle / resolving / 无项 → none', () => {
    expect(resolveHitlSurface(null, 'paused', 's1')).toBe('none')
    expect(resolveHitlSurface(item('clarifying'), 'idle', 's1')).toBe('none')
    expect(resolveHitlSurface(item('tool_confirm'), 'resolving', 's1')).toBe('none')
  })

  it('非当前会话的暂停项 → none（避免跨会话误答）', () => {
    expect(resolveHitlSurface(item('clarifying', 's2'), 'paused', 's1')).toBe('none')
    // 未选择会话（null）时不阻断展示
    expect(resolveHitlSurface(item('clarifying', 's2'), 'paused', null)).toBe('inline')
  })
})
