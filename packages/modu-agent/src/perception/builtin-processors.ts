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
//   - T3-1 修复：此前**只**注册 `text_preprocessor`，而 routing 默认还声明了
//     `llm_parser` / `image_processor` / `audio_processor` → 开关开启后 text 管道
//     第二段恒产生 "processor not found, skip" 告警，`perception.routing` 形同虚设。
//     现按 routing 声明**逐个注册**（四者均无构造期外部依赖，缺依赖时各自降级）。
//   - OCR / ASR 仍是"方向预留"：`image_processor` 无 OCR 库时降级为 metadata-only，
//     `audio_processor` 无 Whisper 时走 fallback。这是**能力缺失**而非接线缺失，
//     需接入 tesseract.js / Whisper 才算落地（见 T3-8）。
//   - `LLMParser` 以 `llmAdapter=null` 注册（避免装配层循环依赖），宿主可经
//     `setLlmAdapter()` 或直接注册自己的实例覆盖；未注入时只用本地方法。
//   - 处理器语言固定 `'zh'`（`TextPreprocessor` 的构造默认值）：`perception.*` 段
//     **无**语言配置键，故不做配置化（如需多语言须新增键并登记进能力注册表与 L7 审计）。
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { ComponentRegistry } from '../core/registry.js'
import type { BasePerception } from '../core/interfaces/perception.js'
import { TextPreprocessor } from './text/rule-based.js'
import { LLMParser } from './text/llm-parser.js'
import { ImageProcessor } from './vision/image-processor.js'
import { AudioProcessor } from './audio/asr-processor.js'

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
 * T3-1：内置处理器注册名 → 构造函数。
 *
 * 修复前**只注册 `text_preprocessor`**，而 `perception.routing.*.pipeline` 默认还声明了
 * `llm_parser` / `image_processor` / `audio_processor` → 开关开启后 text 管道第二段
 * 恒产生 "processor not found, skip" 告警，配置形同虚设。
 *
 * 四个处理器均可在**无外部依赖**时构造并自降级：
 *   - `LLMParser`：`_llmAdapter=null` 时仅用本地方法（llm-parser.ts:212,249-251）
 *   - `ImageProcessor`：OCR 引擎不可用时降级为 metadata-only（image-processor.ts:69-72）
 *   - `AudioProcessor`：Whisper 不可用时走 fallback（asr-processor.ts:69-70）
 * 因此这里统一注册，缺依赖的影响交由各处理器的降级分支承担。
 */
const _BUILTIN_FACTORIES: Record<string, (config: RuntimeConfig) => BasePerception> = {
  text_preprocessor: (config) => {
    const raw = Number(config.get('perception.max_length', 2048))
    const maxLength = Number.isFinite(raw) && raw > 0 ? raw : 2048
    const enableGuard = Boolean(config.get('perception.security.enable_guard', true))
    // 'zh' = `TextPreprocessor` 的构造默认值（`perception.*` 无语言配置键）
    return new TextPreprocessor('zh', maxLength, null, enableGuard)
  },
  llm_parser: () => new LLMParser(null),
  image_processor: () => new ImageProcessor(),
  audio_processor: () => new AudioProcessor(),
}

/**
 * 读取 `perception.routing.*.pipeline` 声明的处理器名（去重、保序）。
 *
 * 找不到配置时回退到 DEFAULT_CONFIG 的三条默认管道，保证行为可预期。
 */
function _declaredProcessorNames(config: RuntimeConfig): string[] {
  const names: string[] = []
  const push = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const n of v) {
        if (typeof n === 'string' && n && !names.includes(n)) names.push(n)
      }
    }
  }
  try {
    const routing = config.get('perception.routing', {}) as Record<string, any>
    for (const inputType of ['text', 'image', 'audio']) {
      push(routing?.[inputType]?.pipeline)
    }
    // default_processor 也可能在没有 routing 时被 pipeline 兜底取用
    const fallback = config.get('perception.default_processor', BUILTIN_PERCEPTION_PROCESSOR_NAME)
    if (typeof fallback === 'string' && fallback && !names.includes(fallback)) {
      names.push(fallback)
    }
  } catch (e) {
    logger.warning('failed to read perception.routing, falling back to defaults: %s', String(e))
    names.push(BUILTIN_PERCEPTION_PROCESSOR_NAME, 'llm_parser')
  }
  // 配置缺失时的最小兜底：至少保证 text_preprocessor 存在
  if (names.length === 0) names.push(BUILTIN_PERCEPTION_PROCESSOR_NAME)
  return names
}

/**
 * 注册内置感知处理器（受 `perception.builtin_processors.enabled` 门控）。
 *
 * T3-1：按 `perception.routing.*.pipeline` 的**声明**逐个注册（此前只注册
 * `text_preprocessor` 一个，导致 routing 里其余处理器永远 "not found"）。
 * 逐项 try/catch 隔离 + 不覆盖宿主注册，语义与原实现一致。
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

  const declared = _declaredProcessorNames(config)
  const registered: string[] = []
  const skipped: string[] = []
  const unavailable: string[] = []

  for (const name of declared) {
    // 设计约束 2：不覆盖宿主注册（装配层只"填补缺失"）
    if (registry.getPerception(name) !== undefined) {
      skipped.push(`${name}(host)`)
      continue
    }
    const factory = _BUILTIN_FACTORIES[name]
    if (!factory) {
      // routing 声明了本次未提供的处理器 → 明确记录，避免静默 "not found" 噪声
      unavailable.push(name)
      continue
    }
    try {
      registry.registerPerception(name, factory(config))
      registered.push(name)
    } catch (e: any) {
      logger.error("failed to register perception '%s': %s", name, String(e?.message ?? e))
      unavailable.push(name)
    }
  }

  // 显式汇总（替代此前"每轮一条 not found"的隐式噪声）
  if (skipped.length > 0) {
    logger.info('perception already registered by host, skipped: %s', skipped.join(', '))
  }
  if (unavailable.length > 0) {
    logger.warning(
      'declared in perception.routing but no builtin implementation available: %s',
      unavailable.join(', '),
    )
  }
  logger.info(
    'builtin perception processors registered: %d (declared=%d)',
    registered.length,
    declared.length,
  )
  if (registered.length > 0) {
    logger.info('registered perception processors: %s', registered.join(', '))
  }
  return registered.length
}
