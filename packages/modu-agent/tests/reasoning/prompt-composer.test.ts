// P1-4 单元测试：四层 Prompt 解耦架构
// 对应文档 §5.2 P1-4 + 风险 R-08：字符等价回归 + 空值兜底 + 注册表模式
import { describe, it, expect, beforeEach } from 'vitest'
import {
  PromptComposer,
  type PromptComposerInput,
} from '@/reasoning/prompt-composer.js'
import {
  DOMAIN_ADAPTERS,
  registerDomainAdapter,
  getDomainAdapter,
  renderDomainAdapter,
  type DomainAdapter,
} from '@/reasoning/domain-adapters.js'

describe('P1-4 四层 Prompt 解耦架构', () => {
  // ============================================================
  // domain-adapters.ts
  // ============================================================
  describe('domain-adapters', () => {
    beforeEach(() => {
      // 清空注册表，避免测试间污染
      for (const key of Object.keys(DOMAIN_ADAPTERS)) {
        delete DOMAIN_ADAPTERS[key]
      }
    })

    describe('getDomainAdapter', () => {
      it('未注册的 domain 返回 null（不抛异常）', () => {
        expect(getDomainAdapter('non_existent')).toBeNull()
      })

      it('空字符串/null/undefined 返回 null', () => {
        expect(getDomainAdapter('')).toBeNull()
        expect(getDomainAdapter(null)).toBeNull()
        expect(getDomainAdapter(undefined)).toBeNull()
      })

      it('已注册的 domain 返回适配器实例', () => {
        const adapter: DomainAdapter = {
          domain_context: '你是测试领域的Agent',
        }
        registerDomainAdapter('test_domain', adapter)
        expect(getDomainAdapter('test_domain')).toEqual(adapter)
      })
    })

    describe('registerDomainAdapter', () => {
      it('空 domain 抛异常', () => {
        expect(() => registerDomainAdapter('', { domain_context: 'x' })).toThrow('non-empty')
      })

      it('注册后可通过 getDomainAdapter 查询', () => {
        registerDomainAdapter('finance', { domain_context: '金融领域' })
        expect(getDomainAdapter('finance')?.domain_context).toBe('金融领域')
      })

      it('重复注册覆盖旧条目', () => {
        registerDomainAdapter('finance', { domain_context: 'v1' })
        registerDomainAdapter('finance', { domain_context: 'v2' })
        expect(getDomainAdapter('finance')?.domain_context).toBe('v2')
      })
    })

    describe('renderDomainAdapter', () => {
      it('null 返回空字符串', () => {
        expect(renderDomainAdapter(null)).toBe('')
      })

      it('仅 domain_context 时只渲染上下文', () => {
        const r = renderDomainAdapter({ domain_context: '你是金融Agent' })
        expect(r).toBe('你是金融Agent')
      })

      it('含术语表时渲染术语列表', () => {
        const r = renderDomainAdapter({
          domain_context: '金融Agent',
          terminology: { PE: '市盈率', ROE: '净资产收益率' },
        })
        expect(r).toContain('金融Agent')
        expect(r).toContain('领域术语表：')
        expect(r).toContain('- PE: 市盈率')
        expect(r).toContain('- ROE: 净资产收益率')
      })

      it('含推理模式时渲染模式列表', () => {
        const r = renderDomainAdapter({
          domain_context: '客服Agent',
          reasoning_patterns: ['先确认身份', '区分紧急度'],
        })
        expect(r).toContain('领域推理模式：')
        expect(r).toContain('- 先确认身份')
        expect(r).toContain('- 区分紧急度')
      })

      it('含输出要求时渲染输出要求', () => {
        const r = renderDomainAdapter({
          domain_context: '金融Agent',
          output_requirements: '数值保留2位小数',
        })
        expect(r).toContain('输出要求：数值保留2位小数')
      })

      it('全字段渲染以双换行分隔', () => {
        const r = renderDomainAdapter({
          domain_context: 'ctx',
          terminology: { T1: '释义1' },
          reasoning_patterns: ['规则1'],
          output_requirements: '要求1',
        })
        const parts = r.split('\n\n')
        expect(parts.length).toBe(4)
        expect(parts[0]).toBe('ctx')
        expect(parts[1]).toContain('领域术语表')
        expect(parts[2]).toContain('领域推理模式')
        expect(parts[3]).toContain('输出要求')
      })

      it('空术语表/空模式数组跳过对应子项', () => {
        const r = renderDomainAdapter({
          domain_context: 'ctx',
          terminology: {},
          reasoning_patterns: [],
        })
        expect(r).toBe('ctx')
      })
    })
  })

  // ============================================================
  // prompt-composer.ts
  // ============================================================
  describe('PromptComposer', () => {
    beforeEach(() => {
      // 清空注册表
      for (const key of Object.keys(DOMAIN_ADAPTERS)) {
        delete DOMAIN_ADAPTERS[key]
      }
    })

    describe('字符等价回归（R-08 策略①）', () => {
      it('仅 systemCore：输出 === systemCore', () => {
        const core = 'You are a helpful assistant.'
        expect(PromptComposer.compose({ systemCore: core })).toBe(core)
      })

      it('domain/taskSpec/runtimeContext 均空/null：输出 === systemCore', () => {
        const core = 'BASE PROMPT'
        const r = PromptComposer.compose({
          systemCore: core,
          domain: null,
          taskSpec: null,
          runtimeContext: null,
        })
        expect(r).toBe(core)
      })

      it('domain 为空字符串：跳过 domain 层，输出 === systemCore', () => {
        const core = 'BASE'
        expect(PromptComposer.compose({ systemCore: core, domain: '' })).toBe(core)
      })

      it('taskSpec 非空：输出 === systemCore + \\n\\n + taskSpec', () => {
        const core = 'BASE'
        const spec = 'TASK SPEC'
        const r = PromptComposer.compose({ systemCore: core, taskSpec: spec })
        expect(r).toBe('BASE\n\nTASK SPEC')
      })

      it('runtimeContext 非空：输出 === systemCore + \\n\\n + runtimeContext', () => {
        const core = 'BASE'
        const ctx = 'RUNTIME CTX'
        const r = PromptComposer.compose({ systemCore: core, runtimeContext: ctx })
        expect(r).toBe('BASE\n\nRUNTIME CTX')
      })

      it('systemCore 为空字符串：返回空字符串', () => {
        expect(PromptComposer.compose({ systemCore: '' })).toBe('')
      })
    })

    describe('四层拼接顺序', () => {
      it('systemCore → taskSpec → runtimeContext 顺序拼接', () => {
        const r = PromptComposer.compose({
          systemCore: 'CORE',
          taskSpec: 'SPEC',
          runtimeContext: 'CTX',
        })
        expect(r).toBe('CORE\n\nSPEC\n\nCTX')
      })

      it('domain 注册后插入到 systemCore 与 taskSpec 之间', () => {
        registerDomainAdapter('demo', { domain_context: 'DOMAIN_CTX' })
        const r = PromptComposer.compose({
          systemCore: 'CORE',
          domain: 'demo',
          taskSpec: 'SPEC',
          runtimeContext: 'CTX',
        })
        expect(r).toBe('CORE\n\nDOMAIN_CTX\n\nSPEC\n\nCTX')
      })
    })

    describe('DOMAIN_ADAPTERS 查找失败兜底（R-08 策略②）', () => {
      it('未注册的 domain：跳过 domain 层，不抛异常', () => {
        const r = PromptComposer.compose({
          systemCore: 'CORE',
          domain: 'unknown_domain',
          taskSpec: 'SPEC',
        })
        // domain 层被跳过，等价于无 domain
        expect(r).toBe('CORE\n\nSPEC')
      })

      it('domain 适配器全空字段：跳过 domain 层', () => {
        registerDomainAdapter('empty', { domain_context: '' })
        const r = PromptComposer.compose({
          systemCore: 'CORE',
          domain: 'empty',
        })
        expect(r).toBe('CORE')
      })
    })

    describe('与 SkillPromptAggregator 集成场景', () => {
      it('systemCore 含 skill 聚合输出时，PromptComposer 仅追加新层', () => {
        // 模拟 factory.ts 中 effectiveSystemPrompt 已经过 SkillPromptAggregator 聚合
        const aggregatedCore = 'BASE PROMPT\n\nSKILL FRAGMENT'
        const r = PromptComposer.compose({
          systemCore: aggregatedCore,
          taskSpec: 'TASK SPEC',
        })
        expect(r).toBe('BASE PROMPT\n\nSKILL FRAGMENT\n\nTASK SPEC')
      })
    })
  })
})
