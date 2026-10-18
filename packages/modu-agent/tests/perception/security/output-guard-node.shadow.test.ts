/**
 * P4 回归：输出护栏影子模式
 *
 * - shadow=true：命中只记录 + 审计，不改写 response
 * - shadow=false：维持原脱敏行为
 * - 未传 options：保持既有行为（脱敏），避免影响直接调用方
 */
import { describe, it, expect } from 'vitest'
import { makeOutputGuardNode } from '../../../src/perception/security/output-guard-node.js'

// api_key_generic 需要 32+ 位
const SECRET = 'api_key=abcdefghijklmnopqrstuvwxyz123456'

function inner() {
  return { response: `配置如下：${SECRET}`, extra: 1 }
}

describe('makeOutputGuardNode — shadow', () => {
  it('shadow=true 时保留原文', () => {
    const node = makeOutputGuardNode(inner, { shadow: true })
    const result = node({ session_id: 's1' })
    expect(result.response).toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(result.extra).toBe(1)
  })

  it('shadow=false 时脱敏', () => {
    const node = makeOutputGuardNode(inner, { shadow: false })
    const result = node({ session_id: 's1' })
    expect(result.response).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(result.response).toContain('REDACTED')
  })

  it('未传 options 时保持既有脱敏行为', () => {
    const node = makeOutputGuardNode(inner)
    const result = node({ session_id: 's1' })
    expect(result.response).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
  })
})
