// builtin-processors.ts
//
// P3（T-23）：内置感知处理器注册 —— 修复 §0.1 #12「感知处理器从未注册」。
//
// 背景（已核实）：`runPerceptionPipeline(Async)` 通过
// `registry.getPerception('text_preprocessor')` 查找处理器（`pipeline.ts:86,154`），
// 但全仓 `src/` **从无 `registerPerception` 调用** → 运行时观察到的后果：
//   ① 感知管线恒为空 → `state.perception_result` 恒为 `null`；
//   ② `injection_detected` / `pii_detected` 恒为 `false` → `routeAfterPerception` 的
//      `block_on_injection` / `block_on_pii` 阻断与 P0（T-04）的两个审计发布点
//      （`perception/text/rule-based.ts:248,259`）在默认运行时**不可达**；
//   ③ `perception.routing.*` 配置形同虚设（配置存在但无执行者）。
//
// 设计约束：
//   1. **默认关闭**（`perception.builtin_processors.enabled` 默认 `false`）。
//      开启会改变**默认运行行为**（`perception_result` 由 null 变非 null、
//      `cleaned_text` 可能被 `perception.max_length` 截断、审计事件开始发布），
//      故必须由宿主 / 场景包显式 opt-in（§2.4.1「默认路径行为零变化」硬约束）。
//   2. **不覆盖宿主注册**：已注册同名处理器时跳过（沿用 P2 复查的第 1 项高危修复
//      结论 —— 装配层只"填补缺失"，不得静默改回内置实现）。
//   3. **逐项 try/catch 隔离**：单个处理器构造/注册失败仅告警，不影响其他处理器与
//      Agent 启动（复用 `perception/pipeline.ts` 与 `skills/loader.ts` 的隔离范式）。
//
// 已知取舍（开启开关后可见）：
//   - `perception.routing.text.pipeline` 默认含 `llm_parser`，而 T-23 **只**注册纯本地
//     `TextPreprocessor` → 管线每轮会为 `llm_parser` 输出一条 "processor not found,
//     skip" 告警。属预期噪声（`pipeline.ts:86,154` 既有行为），待 `LLMParser` 是否
//     启用决策后再消除。
//   - 处理器语言固定 `'zh'`（`TextPreprocessor` 的构造默认值）：`perception.*` 段
//     **无**语言配置键，故不做配置化（如需多语言须新增键并登记进能力注册表与 L7 审计）。
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { ComponentRegistry } from '../core/registry.js'
import { TextPreprocessor } from './text/rule-based.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[perception.builtin] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[perception.builtin] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[perception.builtin] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[perception.builtin] ${msg}`, ...args),
}

/** 注册开关的配置键（单一来源，供装配层、能力注册表与测试共同引用）。 */
export const BUILTIN_PERCEPTION_PROCESSORS_ENABLED_KEY =
  'perception.builtin_processors.enabled'

/** 内置文本处理器名（与 `perception.routing.*.pipeline`、`perception.default_processor` 对齐）。 */
export const BUILTIN_PERCEPTION_PROCESSOR_NAME = 'text_preprocessor'

/**
 * 注册内置感知处理器（受 `perception.builtin_processors.enabled` 门控）。
 *
 * 当前仅注册**纯本地**的 `TextPreprocessor`（无网络 / 无 LLM 调用）。语义型处理器
 * （`LLMParser`，依赖 `LLMAdapter` 与 `perception.deep_parsing.*`）**不在本轮范围**，
 * 其相关配置键保留在 `DECLARED_UNCONSUMED_KEYS` 基线中，待后续单独决策。
 *
 * @returns 实际注册的处理器数量（0 = 开关关闭 / 宿主已注册 / 全部失败）
 */
export function registerBuiltinPerceptionProcessors(
  registry: ComponentRegistry,
  config: RuntimeConfig,
): number {
  let enabled = false
  try {
    enabled = Boolean(config.get(BUILTIN_PERCEPTION_PROCESSORS_ENABLED_KEY, false))
  } catch {
    enabled = false
  }
  if (!enabled) {
    logger.debug('builtin perception processors disabled, skipping')
    return 0
  }

  const name = BUILTIN_PERCEPTION_PROCESSOR_NAME
  if (registry.getPerception(name) !== undefined) {
    logger.info("perception '%s' already registered, skip (host registration wins)", name)
    return 0
  }

  let count = 0
  try {
    // `perception.max_length`：文本最大字符数（此前**零消费**，T-23 接线）。
    const raw = Number(config.get('perception.max_length', 2048))
    const maxLength = Number.isFinite(raw) && raw > 0 ? raw : 2048
    // `perception.security.enable_guard`：是否启用注入 / PII 安全检测。
    // 注：在 `create_agent` 注册时读取一次并固化到处理器实例；运行期改配置不影响
    // 已注册实例（与 `TextPreprocessor` 的不可变构造语义一致）。
    const enableGuard = Boolean(config.get('perception.security.enable_guard', true))

    // 'zh' = `TextPreprocessor` 的构造默认值（`perception.*` 无语言配置键）
    registry.registerPerception(name, new TextPreprocessor('zh', maxLength, null, enableGuard))
    count += 1
  } catch (e: any) {
    logger.error("failed to register perception '%s': %s", name, String(e?.message ?? e))
  }

  if (count > 0) {
    logger.info('builtin perception processors registered: %d', count)
  }
  return count
}
