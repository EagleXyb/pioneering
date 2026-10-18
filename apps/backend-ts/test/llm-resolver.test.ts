/**
 * P2 回归：宿主注入的 LLM 连接解析器
 *
 * 验证 modu-agent 在注册 resolver 后不再使用 env 解析，
 * 而是采用宿主返回的 apiKey / baseUrl / model。
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  build_chat_model,
  getLLMConnectionResolver,
  setLLMConnectionResolver,
  _resetLLMConnectionResolverForTest,
} from '@pioneering/modu-agent'

afterEach(() => {
  _resetLLMConnectionResolverForTest()
})

describe('setLLMConnectionResolver', () => {
  it('注册/清除解析器', () => {
    const resolver = () => ({
      apiKey: 'k',
      baseUrl: 'http://x.test/v1',
      model: 'm',
    })
    setLLMConnectionResolver(resolver)
    expect(getLLMConnectionResolver()).toBe(resolver)
    setLLMConnectionResolver(null)
    expect(getLLMConnectionResolver()).toBeNull()
  })

  it('构造 ChatModel 时优先使用注入的解析器', () => {
    const calls: Array<{ provider: string; model?: string | null }> = []
    setLLMConnectionResolver((input) => {
      calls.push(input)
      return {
        apiKey: 'injected-key',
        baseUrl: 'https://resolver.test/v1',
        model: 'resolved-model',
      }
    })

    const llm = build_chat_model('deepseek', null, 0.1, 64, 'deepseek-v4-pro')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
    })
    // ChatOpenAI 的公开 model 字段应来自 resolver，而不是 env
    expect((llm as unknown as { model: string }).model).toBe('resolved-model')
  })
})
