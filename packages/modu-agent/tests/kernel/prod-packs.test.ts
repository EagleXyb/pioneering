// T5.3：pro / task 生产场景包装配 + 领域/护栏/工具过滤 + 作用域回滚。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ScenarioLoader,
  resetScenarioLoader,
} from '@/kernel/scenario-loader.js'
import { resetRegistry, getRegistry } from '@/core/registry.js'
import {
  getConfig,
  resetConfig,
} from '@/config/runtime-config.js'
import { getDomainAdapter } from '@/reasoning/domain-adapters.js'
import { PromptComposer } from '@/reasoning/prompt-composer.js'
import {
  decideToolApprovals,
  peekGuardrailRule,
} from '@/tools/tool-guardrails.js'
import { filterToolsByTaskTypeAndIntent } from '@/tools/tool-registry.js'
import {
  isRegisteredPlanTaskType,
  isRegisteredSopRole,
  resetSopRegistry,
} from '@/orchestration/sop-registry.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKS_DIR = path.resolve(HERE, '..', '..', 'packs')

let loader: ScenarioLoader

beforeEach(() => {
  resetConfig()
  resetRegistry()
  resetSopRegistry()
  resetScenarioLoader()
  loader = new ScenarioLoader({ packsDir: PACKS_DIR })
})

afterEach(async () => {
  for (const name of [...loader.listActive()].reverse()) {
    await loader.deactivate(name).catch(() => undefined)
  }
  resetConfig()
  resetRegistry()
  resetSopRegistry()
  resetScenarioLoader()
})

describe('T5.3 research-pack（pro / react_agent）', () => {
  it('装配研究领域、护栏与 SOP，领域进入 PromptComposer，doc_writer 走护栏审批', async () => {
    await loader.activate('research-pack')

    // 领域
    expect(getDomainAdapter('research_writer')).not.toBeNull()
    expect(getDomainAdapter('research_writer')?.domain_context).toContain(
      '研究分析',
    )
    // frontmatter 结构化字段已解析（非回退正文）
    expect(getDomainAdapter('research_writer')?.terminology?.['一手来源']).toBeTruthy()
    expect(getDomainAdapter('research_writer')?.output_requirements).toContain(
      '区分事实与推断',
    )

    // pack 打开四层 Prompt + 写操作护栏开关
    expect(
      getConfig().get('react_optimization.prompt_composer.enabled'),
    ).toBe(true)
    expect(
      getConfig().get('react_optimization.action_guardrails.enabled'),
    ).toBe(true)

    // 护栏规则 + SOP
    expect(peekGuardrailRule('research_doc_writer_approval')).not.toBeNull()
    expect(isRegisteredSopRole('fact_checker')).toBe(true)
    expect(isRegisteredPlanTaskType('research')).toBe(true)

    // 领域文本进入组装后的 system prompt
    const prompt = PromptComposer.compose({
      systemCore: 'SYS',
      domain: 'research_writer',
    })
    expect(prompt).toContain('SYS')
    expect(prompt).toContain('研究分析')

    // 护栏强制：doc_writer 调用需审批
    const decisions = decideToolApprovals(
      [{ id: 'c1', name: 'doc_writer', args: {} }],
      {
        guardrailsEnabled: true,
        guardrailDryRun: false,
        sensitiveTools: [],
        registry: getRegistry(),
        approvalContext: {},
      },
    )
    expect(decisions[0].requiresApproval).toBe(true)
    expect(decisions[0].source).toBe('guardrail')

    // 卸载回滚
    await loader.deactivate('research-pack')
    expect(getDomainAdapter('research_writer')).toBeNull()
    expect(peekGuardrailRule('research_doc_writer_approval')).toBeNull()
    expect(isRegisteredSopRole('fact_checker')).toBe(false)
    expect(
      getConfig().get('react_optimization.prompt_composer.enabled'),
    ).toBe(false)
  })
})

describe('T5.3 planning-pack（task / plan_execute）', () => {
  it('装配任务规划领域、护栏与步骤类型，领域进入 PromptComposer，卸载回滚', async () => {
    await loader.activate('planning-pack')

    expect(getDomainAdapter('task_planner')).not.toBeNull()
    expect(getDomainAdapter('task_planner')?.domain_context).toContain(
      '任务规划',
    )
    expect(getDomainAdapter('task_planner')?.output_requirements).toContain(
      '验收标准',
    )

    expect(peekGuardrailRule('planning_doc_writer_approval')).not.toBeNull()
    expect(isRegisteredSopRole('planner')).toBe(true)
    expect(isRegisteredPlanTaskType('planning')).toBe(true)

    const prompt = PromptComposer.compose({
      systemCore: 'SYS',
      domain: 'task_planner',
    })
    expect(prompt).toContain('任务规划')

    await loader.deactivate('planning-pack')
    expect(getDomainAdapter('task_planner')).toBeNull()
    expect(peekGuardrailRule('planning_doc_writer_approval')).toBeNull()
    expect(isRegisteredPlanTaskType('planning')).toBe(false)
  })
})

describe('T5.3 两包并存：工具按 task_type 过滤 + 全部卸载回滚', () => {
  it('research 任务类型只保留研究类工具；两包卸载后状态复原', async () => {
    await loader.activate('research-pack')
    await loader.activate('planning-pack')

    expect(getDomainAdapter('research_writer')).not.toBeNull()
    expect(getDomainAdapter('task_planner')).not.toBeNull()

    // 工具过滤：research 类型只保留矩阵中声明 research 的工具
    const tools = [
      { name: 'search_engine' },
      { name: 'calculator' },
      { name: 'code_executor' },
    ]
    const researchTools = filterToolsByTaskTypeAndIntent(tools, 'research')
    expect(researchTools.map((t) => t.name)).toEqual(['search_engine'])

    // 全部卸载：领域与开关复原
    await loader.deactivate('planning-pack')
    await loader.deactivate('research-pack')
    expect(getDomainAdapter('research_writer')).toBeNull()
    expect(getDomainAdapter('task_planner')).toBeNull()
    expect(
      getConfig().get('react_optimization.prompt_composer.enabled'),
    ).toBe(false)
    expect(
      getConfig().get('react_optimization.action_guardrails.enabled'),
    ).toBe(false)
  })
})
