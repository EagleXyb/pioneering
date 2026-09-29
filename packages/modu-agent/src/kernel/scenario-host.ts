// scenario-host.ts
//
// P3-B：场景包宿主 —— 内核提供给单个场景包的**唯一交互面**。
//
// 职责：
//   1. 收口全部扩展注册 API（领域/Prompt/护栏/SOP 字典/工具/策略/拓扑/配置）；
//   2. 作用域回滚：每次注册均记录反向操作，`deactivate()` 逆序执行，
//      使场景包"可插拔"具备运行时闭环（卸载后注册表恢复到激活前状态）；
//   3. 场景包不得绕过 host 直接 import 内核源码（由架构测试 B-4 强制）。
import type { ComponentRegistry } from '../core/registry.js'
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { PromptTemplate } from '../core/interfaces/prompt.js'
import {
  getPromptRegistry,
} from '../reasoning/prompt-registry.js'
import type { DomainAdapter } from '../reasoning/domain-adapters.js'
import {
  getDomainAdapter,
  registerDomainAdapter,
  unregisterDomainAdapter,
} from '../reasoning/domain-adapters.js'
import type { GuardrailRule } from '../tools/tool-guardrails.js'
import {
  peekGuardrailRule,
  registerGuardrailRule,
  unregisterGuardrailRule,
} from '../tools/tool-guardrails.js'
import {
  isRegisteredPlanTaskType,
  isRegisteredSopRole,
  registerPlanTaskType,
  registerSopRole,
  unregisterPlanTaskType,
  unregisterSopRole,
} from '../orchestration/sop-registry.js'
import type {
  EdgeSpec,
  NodeSpec,
  SubgraphSpec,
} from '../graph/spec.js'

/** 场景包入口模块契约（pack entry，可选）。 */
export interface ScenarioEntryModule {
  /** 命名导出 activate：装配本包全部代码型扩展。 */
  activate?: (host: ScenarioHost) => void | Promise<void>
  /** 默认导出等价 activate（二选一，命名导出优先）。 */
  default?: (host: ScenarioHost) => void | Promise<void>
}

/** 配置缺哨兵（区分"键不存在"与"键值为 null"）。 */
const _ABSENT = Symbol('config.absent')

/**
 * 场景包宿主。
 *
 * 一个已激活场景包对应一个 host 实例；host 与场景包同生命周期。
 */
export class ScenarioHost {
  /** 场景包名（= manifest.name，同时作为作用域标识）。 */
  readonly scope: string
  /** 场景包目录绝对路径。 */
  readonly packDir: string
  /** 组件注册中心（全局单例）。 */
  readonly registry: ComponentRegistry
  /** 运行时配置（全局单例）。 */
  readonly config: RuntimeConfig

  private _undos: Array<() => void> = []
  private _active: boolean = true

  constructor(args: {
    scope: string
    packDir: string
    registry: ComponentRegistry
    config: RuntimeConfig
  }) {
    this.scope = args.scope
    this.packDir = args.packDir
    this.registry = args.registry
    this.config = args.config
  }

  /** 场景包是否仍处于激活状态。 */
  get active(): boolean {
    return this._active
  }

  /** 记录一条反向操作（deactivate 时逆序执行）。 */
  private track(undo: () => void): void {
    if (!this._active) throw new Error(`scenario pack '${this.scope}' has been deactivated`)
    this._undos.push(undo)
  }

  // ---- 领域知识 ----

  /** 注册领域适配器（替换/新增均支持，作用域内可回滚）。 */
  registerDomain(name: string, adapter: DomainAdapter): void {
    const prior = getDomainAdapter(name)
    registerDomainAdapter(name, adapter)
    this.track(() => {
      if (prior) registerDomainAdapter(name, prior)
      else unregisterDomainAdapter(name)
    })
  }

  // ---- Prompt ----

  /** 注册 Prompt 模板（同 id 覆盖，作用域内可回滚）。 */
  registerPrompt(template: PromptTemplate): void {
    const prior = this.registry.getPrompt(template.id)
    this.registry.registerPrompt(template)
    this.track(() => {
      if (prior) this.registry.registerPrompt(prior)
      else getPromptRegistry().unregister?.(template.id)
    })
  }

  // ---- 业务护栏 ----

  /** 注册 guardrail 规则（同 rule_id 覆盖，作用域内可回滚）。 */
  registerGuardrail(rule: GuardrailRule): void {
    const prior = peekGuardrailRule(rule.rule_id)
    registerGuardrailRule(rule)
    this.track(() => {
      if (prior) registerGuardrailRule(prior)
      else unregisterGuardrailRule(rule.rule_id)
    })
  }

  // ---- SOP 字典 ----

  /** 追加 Supervisor 角色（仅登记新增项，卸载时摘除）。 */
  registerSopRoles(roles: readonly string[]): void {
    for (const role of roles) {
      if (!isRegisteredSopRole(role)) {
        registerSopRole(role)
        this.track(() => unregisterSopRole(role))
      }
    }
  }

  /** 追加 Plan-Execute 步骤类型（仅登记新增项，卸载时摘除）。 */
  registerPlanTaskTypes(types: readonly string[]): void {
    for (const type of types) {
      const existed = isRegisteredPlanTaskType(type)
      if (!existed) {
        registerPlanTaskType(type)
        this.track(() => unregisterPlanTaskType(type))
      }
    }
  }

  // ---- 底座组件 ----

  /** 注册工具（同名覆盖，作用域内可回滚）。 */
  registerTool(tool: any): void {
    const name = tool.name()
    const prior = this.registry.getTool(name)
    this.registry.registerTool(tool)
    this.track(() => {
      if (prior) this.registry.registerTool(prior)
      else this.registry.unregisterTool(name)
    })
  }

  /** 注册 LLM provider（同 id 覆盖，作用域内可回滚）。 */
  registerLLMProvider(factory: any): void {
    const prior = this.registry.getLLMProvider(factory.id)
    this.registry.registerLLMProvider(factory)
    this.track(() => {
      if (prior) this.registry.registerLLMProvider(prior)
      else this.registry.unregisterLLMProvider(factory.id)
    })
  }

  /** 注册记忆策略（作用域内可回滚）。 */
  registerMemoryStrategy(strategy: any, opts: { makeDefault?: boolean } = {}): void {
    const prior = this.registry.getMemoryStrategy(strategy.id)
    this.registry.registerMemoryStrategy(strategy, opts)
    this.track(() => {
      if (prior) this.registry.registerMemoryStrategy(prior)
      else this.registry.unregisterMemoryStrategy(strategy.id)
    })
  }

  /** 注册上下文策略（作用域内可回滚）。 */
  registerContextStrategy(strategy: any, opts: { makeDefault?: boolean } = {}): void {
    const prior = this.registry.getContextStrategy(strategy.id)
    this.registry.registerContextStrategy(strategy, opts)
    this.track(() => {
      if (prior) this.registry.registerContextStrategy(prior)
      else this.registry.unregisterContextStrategy(strategy.id)
    })
  }

  /** 注册策略规则（仅新增可回滚；覆盖内置旧对象无法恢复，调用方应避免）。 */
  registerPolicyRule(rule: any): void {
    const existed = this.registry.listPolicyRules().includes(rule.id)
    this.registry.registerPolicyRule(rule)
    if (!existed) {
      this.track(() => this.registry.unregisterPolicyRule(rule.id))
    }
  }

  // ---- 图拓扑 ----

  /** 注册图节点声明（作用域内可回滚；P3-D 起支持 override）。 */
  registerNode(spec: NodeSpec): void {
    this.registry.registerNode(spec)
    this.track(() => this.registry.removeNodeSpec(spec.name))
  }

  /** 注册图边声明（作用域内可回滚）。 */
  registerEdge(spec: EdgeSpec): void {
    this.registry.registerEdge(spec)
    this.track(() => this.registry.removeEdgeSpec(spec.from))
  }

  /** 注册扩展子图（作用域内可回滚）。 */
  registerSubgraph(spec: SubgraphSpec): void {
    this.registry.registerSubgraph(spec)
    this.track(() => this.registry.removeSubgraph(spec.name))
  }

  /**
   * P3-D：受控裁剪默认/已注册边。
   *
   * @param from 边源节点
   * @param to   目标节点名（省略=裁剪该 from 的全部边；条件边传 '(conditional)'）
   */
  removeEdge(from: string, to?: string): void {
    const removal = { from, to }
    this.registry.registerEdgeRemoval(removal)
    this.track(() => this.registry.unregisterEdgeRemoval(removal))
  }

  // ---- 配置覆盖 ----

  /**
   * 点分键配置覆盖（逐键回滚）。
   * 覆盖值在 deactivate 时恢复旧值（含"键原本不存在"）。
   */
  applyConfigOverrides(overrides: Record<string, any>): void {
    for (const [key, value] of Object.entries(overrides)) {
      const existed = this.config.get(key, _ABSENT) !== _ABSENT
      const old = this.config.update(key, value)
      this.track(() => {
        if (existed) this.config.update(key, old)
        else this.config.update(key, undefined)
      })
    }
  }

  /**
   * 合并 `graph.spec.extra` 画像扩展开关（供场景包 when 门控；逐包合并、可回滚）。
   */
  mergeGraphExtra(extra: Record<string, boolean>): void {
    const current = (this.config.get('graph.spec.extra', {}) ?? {}) as Record<string, boolean>
    const merged = { ...current, ...extra }
    this.config.update('graph.spec.extra', merged)
    this.track(() => this.config.update('graph.spec.extra', current))
  }

  // ---- 生命周期 ----

  /**
   * 卸载场景包：逆序执行全部反向操作。
   * 幂等（重复调用安全）。
   */
  deactivate(): void {
    if (!this._active) return
    this._active = false
    for (const undo of this._undos.reverse()) {
      try {
        undo()
      } catch (e: any) {
        console.error(
          `[kernel.host] undo failed for pack '${this.scope}': ${String(e?.message ?? e)}`,
        )
      }
    }
    this._undos = []
  }
}
