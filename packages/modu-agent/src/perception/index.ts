// 对应 Python: components/perception/__init__.py
// 感知层模块统一导出（P0-优化: 统一 barrel 策略，重导出 pipeline/fusion/子模块核心类）
//
// 导出内容：
//   - 公共工具函数：buildPerceptionEventMetadata / extractPerceptionContext
//   - 管线入口：runPerceptionPipeline / runPerceptionPipelineAsync（pipeline.ts）
//   - 融合器：PerceptionFusion（fusion.ts）
//   - 文本感知器：TextPreprocessor / LLMParser / LLMAdapter（text/）
//   - 视觉感知器：CameraSensor / TimerSensor / MicrophoneSensor / ImageProcessor（vision/）
//   - 音频感知器：AudioProcessor（audio/）
//   - 安全守卫：SecurityGuard（security/）

// 公共工具函数（对应问题 11：事件追踪信息标准化）
/**
 * 从感知结果构建标准化事件 metadata。
 *
 * 将感知结果中的所有关键字段转为字符串，用于 AgentEvent.metadata。
 * 确保事件日志包含完整的可观测性信息。
 *
 * Args:
 *     perceptionResult: 感知器输出结果
 *     inputType: 输入类型（text/image/audio）
 *
 * Returns:
 *     标准化的 metadata 字典（所有值为字符串）
 */
export function buildPerceptionEventMetadata(
  perceptionResult: Record<string, any>,
  inputType: string,
): Record<string, string> {
  const meta: Record<string, any> = perceptionResult['metadata'] ?? {}
  const truncationInfo: Record<string, any> = meta['truncation_info'] ?? {}
  const securityDetails: Record<string, any> = meta['security_details'] ?? {}
  const sanitizationWarnings: Record<string, any> = meta['sanitization_warnings'] ?? {}

  return {
    // 基础字段
    input_type: inputType,
    detected_language: String(perceptionResult['detected_language'] ?? ''),
    confidence: String(perceptionResult['confidence'] ?? 1.0),
    // 安全字段
    sensitivity_level: String(meta['sensitivity_level'] ?? 0),
    sensitivity_label: String(meta['sensitivity_label'] ?? 'safe'),
    security_score: String(perceptionResult['security_score'] ?? meta['security_score'] ?? 1.0),
    injection_detected: String(meta['injection_detected'] ?? false),
    pii_detected: String(meta['pii_detected'] ?? false),
    // 截断字段
    truncated: String(meta['truncated'] ?? false),
    original_length: String(meta['original_length'] ?? 0),
    truncated_length: String(truncationInfo['truncated_length'] ?? 0),
    truncation_ratio: String(truncationInfo['truncation_ratio'] ?? 1.0),
    // 语义字段
    intent: perceptionResult['intent'] ? JSON.stringify(perceptionResult['intent']) : '{}',
    entity_count: String((perceptionResult['entities'] ?? []).length),
    sentiment: perceptionResult['sentiment'] ? JSON.stringify(perceptionResult['sentiment']) : '{}',
    quality_score: String(perceptionResult['quality_score'] ?? 0.0),
    language_mixed: String(perceptionResult['language_mixed'] ?? false),
    language_distribution: JSON.stringify(perceptionResult['language_distribution'] ?? {}),
    // 编码字段
    decoding_errors: String(meta['decoding_errors'] ?? 0),
    sanitization_warnings: JSON.stringify(sanitizationWarnings),
    // 安全详情
    security_details: securityDetails ? JSON.stringify(securityDetails) : '{}',
  }
}

/**
 * 从感知结果中提取需要注入 LLM context 的字段（对应问题 7）。
 *
 * 将感知结果中的语义字段提取为可注入 LLM context 的结构。
 */
export function extractPerceptionContext(
  perceptionResult: Record<string, any>,
): Record<string, any> {
  return {
    detected_language: perceptionResult['detected_language'] ?? null,
    confidence: perceptionResult['confidence'] ?? null,
    intent: perceptionResult['intent'] ?? null,
    entities: perceptionResult['entities'] ?? [],
    sentiment: perceptionResult['sentiment'] ?? null,
    quality_score: perceptionResult['quality_score'] ?? null,
    language_mixed: perceptionResult['language_mixed'] ?? false,
    language_distribution: perceptionResult['language_distribution'] ?? null,
    security_score: perceptionResult['security_score'] ?? null,
    sensitivity_level: (perceptionResult['metadata'] ?? {})['sensitivity_level'] ?? 0,
  }
}

// 管线入口（pipeline.ts）
export {
  runPerceptionPipeline,
  runPerceptionPipelineAsync,
} from './pipeline.js'

// 融合器（fusion.ts）
export { PerceptionFusion } from './fusion.js'

// 文本感知器（text/）
export { TextPreprocessor } from './text/rule-based.js'
export { LLMParser } from './text/llm-parser.js'
export type { LLMAdapter } from './text/llm-parser.js'

// 视觉感知器（vision/）
export { CameraSensor, TimerSensor, MicrophoneSensor } from './vision/camera.js'
export { ImageProcessor } from './vision/image-processor.js'

// 音频感知器（audio/）
export { AudioProcessor } from './audio/asr-processor.js'

// 安全守卫（security/）
export { SecurityGuard } from './security/guard.js'
