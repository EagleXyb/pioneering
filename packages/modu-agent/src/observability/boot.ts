// P0（T-01）：观测统一 boot 入口。
//
// 背景：`configure_structured_logging` / `configure_otlp_exporter` / `start_prometheus_server`
// 三个能力早已实现，但全仓无调用点（"已实现未接线"）。本模块提供单一 boot 入口，
// 由 create_agent 调用，让观测能力真正进入运行时。
//
// 硬约束（默认行为零变化）：
//   - 严格按 observability.*.enabled 门控，三项默认均为 false → 调用链为 no-op，
//     不创建任何 exporter、不绑定任何端口、不替换 console。
//   - 逐项 try/catch 隔离：任一项失败仅记录，不影响 Agent 启动。
//   - 进程内幂等：重复调用只 boot 一次（避免每次 create_agent 重复绑定端口）。
//
// 被激活的死配置键（此前声明但无消费者）：
//   - observability.tracing.otlp_endpoint
//   - observability.tracing.service_name
//   - observability.tracing.sampling_rate
//   - observability.metrics.prometheus_port
//   - observability.metrics.path

import type { RuntimeConfig } from '../config/runtime-config.js'
import { configure_structured_logging } from './logging-config.js'
import { configure_otlp_exporter, start_prometheus_server } from './exporters.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[observability.boot] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[observability.boot] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[observability.boot] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[observability.boot] ${msg}`, ...args),
}

/** boot 结果（供调试/诊断与测试断言使用）。 */
export interface ObservabilityBootResult {
  /** 本次调用是否真正执行了 boot（false = 已 boot 过或无配置） */
  executed: boolean
  loggingEnabled: boolean
  tracingEnabled: boolean
  metricsEnabled: boolean
  errors: Array<{ component: string; error: string }>
}

// 进程内幂等标记
let _booted = false

/** 重置 boot 标记（测试清理用）。 */
export function reset_observability_boot(): void {
  _booted = false
}

/**
 * 统一 boot 观测能力。
 *
 * @param runtimeConfig 运行时配置；null/undefined 时不执行任何操作（等价现状）
 * @returns boot 结果
 */
export async function boot_observability(
  runtimeConfig?: RuntimeConfig | null,
): Promise<ObservabilityBootResult> {
  const result: ObservabilityBootResult = {
    executed: false,
    loggingEnabled: false,
    tracingEnabled: false,
    metricsEnabled: false,
    errors: [],
  }

  if (!runtimeConfig) {
    return result
  }
  if (_booted) {
    logger.debug('boot_observability: already booted, skipping')
    return result
  }
  _booted = true
  result.executed = true

  // ---------------- 1) 结构化日志 ----------------
  let structuredLogging = false
  let logLevel = 'INFO'
  try {
    structuredLogging = Boolean(runtimeConfig.get('observability.logging.structured', false))
    logLevel = String(runtimeConfig.get('observability.logging.level', 'INFO') ?? 'INFO')
  } catch {
    structuredLogging = false
  }
  if (structuredLogging) {
    try {
      configure_structured_logging(structuredLogging, logLevel)
      result.loggingEnabled = true
    } catch (e: any) {
      result.errors.push({ component: 'logging', error: String(e?.message ?? e) })
      logger.warning('structured logging boot failed: %s', String(e?.message ?? e))
    }
  }

  // ---------------- 2) OTLP tracing exporter ----------------
  let tracingEnabled = false
  let otlpEndpoint = ''
  let serviceName = 'modu-agent'
  let samplingRate: number | undefined
  try {
    tracingEnabled = Boolean(runtimeConfig.get('observability.tracing.enabled', false))
    otlpEndpoint = String(runtimeConfig.get('observability.tracing.otlp_endpoint', '') ?? '')
    serviceName = String(runtimeConfig.get('observability.tracing.service_name', 'modu-agent') ?? 'modu-agent')
    const sr = runtimeConfig.get('observability.tracing.sampling_rate', 0.1)
    samplingRate = typeof sr === 'number' && sr >= 0 && sr <= 1 ? sr : undefined
  } catch {
    tracingEnabled = false
  }
  if (tracingEnabled) {
    if (otlpEndpoint) {
      try {
        result.tracingEnabled = await configure_otlp_exporter(otlpEndpoint, serviceName, samplingRate)
      } catch (e: any) {
        result.errors.push({ component: 'tracing', error: String(e?.message ?? e) })
        logger.warning('OTLP exporter boot failed: %s', String(e?.message ?? e))
      }
    } else {
      logger.debug('tracing enabled but otlp_endpoint empty, exporter not started')
    }
  }

  // ---------------- 3) Prometheus metrics server ----------------
  let metricsEnabled = false
  let prometheusPort = 9090
  let prometheusPath = '/metrics'
  try {
    metricsEnabled = Boolean(runtimeConfig.get('observability.metrics.enabled', false))
    prometheusPort = Number(runtimeConfig.get('observability.metrics.prometheus_port', 9090)) || 9090
    prometheusPath = String(runtimeConfig.get('observability.metrics.path', '/metrics') ?? '/metrics')
  } catch {
    metricsEnabled = false
  }
  if (metricsEnabled) {
    try {
      const server = await start_prometheus_server(prometheusPort, prometheusPath)
      result.metricsEnabled = server !== null
      if (server === null) {
        result.errors.push({ component: 'metrics', error: 'prometheus server not started' })
      }
    } catch (e: any) {
      result.errors.push({ component: 'metrics', error: String(e?.message ?? e) })
      logger.warning('prometheus server boot failed: %s', String(e?.message ?? e))
    }
  }

  if (result.loggingEnabled || result.tracingEnabled || result.metricsEnabled) {
    logger.info(
      'observability boot done: logging=%s tracing=%s metrics=%s errors=%d',
      result.loggingEnabled, result.tracingEnabled, result.metricsEnabled, result.errors.length,
    )
  } else {
    logger.debug('observability boot: all disabled (no-op, behavior unchanged)')
  }

  return result
}
