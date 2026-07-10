// 对应 Python: components/perception/pipeline.py
// 感知管线公共入口（P1-5：提取公共感知管线）
//
// 将 coordinator._run_perception_pipeline 与 nodes.perception_node 中重复的
// 感知管线逻辑提取为统一函数，消除复制粘贴。
//
// 流程：
//     1. 根据 input_type 从 routing 配置获取感知器链
//     2. 依次执行每个感知器，前一个的输出文本作为后一个的输入
//     3. 若有多个感知器结果，使用 PerceptionFusion 融合
//
// P2-12.3.4：新增异步并行版本 run_perception_pipeline_async，
// 独立感知器（不依赖前一感知器输出）可并行执行，依赖感知器串行。
import { PerceptionFusion } from './fusion.js'
import type { ComponentRegistry } from '../core/registry.js'
import type { RuntimeConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[pipeline] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[pipeline] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[pipeline] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[pipeline] ${msg}`, ...args),
}

/** 从配置解析感知器链。 */
function _resolvePipeline(config: RuntimeConfig, inputType: string): string[] {
  const routing = config.get('perception.routing', {}) as Record<string, any>
  const pipelineConfig = (routing[inputType] ?? {}) as Record<string, any>
  let pipeline: string[] = pipelineConfig['pipeline'] ?? ['text_preprocessor']
  if (!pipeline || pipeline.length === 0) {
    pipeline = ['text_preprocessor']
  }
  return pipeline
}

/** 融合多路感知结果。 */
function _fuseResults(
  config: RuntimeConfig,
  results: Array<Record<string, any>>,
): Record<string, any> | null {
  if (results.length === 0) {
    return null
  }
  if (results.length === 1) {
    return results[0]
  }
  const fusion = new PerceptionFusion(
    config.get('perception.fusion.strategy', 'weighted_average'),
    config.get('perception.fusion.weights'),
  )
  return fusion.fuse(results)
}

/**
 * 执行感知管线：输入路由 + 感知器链 + 多路融合。
 *
 * 统一入口，供 Coordinator（legacy）和 LangGraph perception_node 共用，
 * 消除两处复制粘贴的重复逻辑。
 *
 * Args:
 *     inputData: 输入数据，包含 input_type / prompt / sensitivity_level
 *     config: RuntimeConfig 实例，提供 perception.routing 等配置
 *     registry: ComponentRegistry 实例，提供感知器查找
 *
 * Returns:
 *     融合后的感知结果字典；无结果时返回 null
 */
export async function runPerceptionPipeline(
  inputData: Record<string, any>,
  config: RuntimeConfig,
  registry: ComponentRegistry,
): Promise<Record<string, any> | null> {
  const inputType = (inputData['input_type'] as string) ?? 'text'
  const rawContent = new TextEncoder().encode(
    (inputData['prompt'] as string) ?? '',
  )
  const sensitivityLevel = (inputData['sensitivity_level'] as number) ?? 0

  const pipeline = _resolvePipeline(config, inputType)

  const results: Array<Record<string, any>> = []
  let currentContent = rawContent
  let currentInputType = inputType

  for (const processorName of pipeline) {
    const perception = registry.getPerception(processorName)
    if (perception === undefined) {
      logger.warning("Perception component '%s' not registered, skipping", processorName)
      continue
    }

    try {
      const result = await perception.perceive(
        currentInputType,
        currentContent,
        undefined,
        sensitivityLevel,
      )
      results.push(result)

      // 管线传递：若感知器输出转为文本，则后续感知器以文本为输入
      const parsed = (result['parsed_content'] ?? {}) as Record<string, any>
      if (parsed['text'] && parsed['input_type'] === 'text') {
        currentContent = new TextEncoder().encode(parsed['text'] as string)
        currentInputType = 'text'
      }
    } catch (e) {
      logger.error("Perception '%s' failed: %s", processorName, String(e))
      continue
    }
  }

  return _fuseResults(config, results)
}

/**
 * 异步执行感知管线（P2-12.3.4：独立感知器并行化）。
 *
 * 策略：
 *     - 第一个感知器串行执行（确定输入类型/文本基线）
 *     - 后续不依赖前一感知器文本输出的独立感知器并行执行
 *     - 依赖前一感知器输出的感知器串行执行
 *
 * 感知器并行通过 Promise.all 包装异步 perceive 调用，
 * 避免阻塞事件循环。
 *
 * Args:
 *     inputData: 输入数据，包含 input_type / prompt / sensitivity_level
 *     config: RuntimeConfig 实例，提供 perception.routing 等配置
 *     registry: ComponentRegistry 实例，提供感知器查找
 *
 * Returns:
 *     融合后的感知结果字典；无结果时返回 null
 */
export async function runPerceptionPipelineAsync(
  inputData: Record<string, any>,
  config: RuntimeConfig,
  registry: ComponentRegistry,
): Promise<Record<string, any> | null> {
  const inputType = (inputData['input_type'] as string) ?? 'text'
  const rawContent = new TextEncoder().encode(
    (inputData['prompt'] as string) ?? '',
  )
  const sensitivityLevel = (inputData['sensitivity_level'] as number) ?? 0

  const pipeline = _resolvePipeline(config, inputType)

  async function _perceiveSafe(
    name: string,
    inType: string,
    content: Uint8Array,
    level: number,
  ): Promise<[string, Record<string, any> | null]> {
    const perception = registry.getPerception(name)
    if (perception === undefined) {
      logger.warning("Perception component '%s' not registered, skipping", name)
      return [name, null]
    }
    try {
      const result = await perception.perceive(inType, content, undefined, level)
      return [name, result]
    } catch (e) {
      logger.error("Perception '%s' failed: %s", name, String(e))
      return [name, null]
    }
  }

  const results: Array<Record<string, any>> = []
  let currentContent = rawContent
  let currentInputType = inputType

  // 首个感知器串行执行，建立文本基线
  if (pipeline.length > 0) {
    const [, result] = await _perceiveSafe(
      pipeline[0], currentInputType, currentContent, sensitivityLevel,
    )
    if (result !== null) {
      results.push(result)
      const parsed = (result['parsed_content'] ?? {}) as Record<string, any>
      if (parsed['text'] && parsed['input_type'] === 'text') {
        currentContent = new TextEncoder().encode(parsed['text'] as string)
        currentInputType = 'text'
      }
    }
  }

  // 后续感知器：基于前一感知器输出并行执行（输入为已建立的文本基线）
  if (pipeline.length > 1) {
    const tasks = pipeline.slice(1).map((n) =>
      _perceiveSafe(n, currentInputType, currentContent, sensitivityLevel),
    )
    const outcomes = await Promise.all(tasks)
    for (const [, res] of outcomes) {
      if (res !== null) {
        results.push(res)
      }
    }
  }

  return _fuseResults(config, results)
}
