// 可观测性管理路由（T5.4）
//
//   GET /observability/settings  查看 tracing / metrics / 结构化日志开关与导出配置
//   PUT /observability/settings  更新开关与 OTLP endpoint（写 RuntimeConfig）
//   GET /observability/metrics    以 Prometheus exposition 文本暴露指标
//
// 指标采集与 record_* 仪表化均在 modu-agent（runner/tool-adapter/llm-metrics），
// 本路由只做「开关控制 + 指标透出」。框架默认三项开关均为 false，不强制开启。
import { FastifyPluginAsync } from 'fastify'
import {
  getConfig,
  get_metrics_registry,
  reset_metrics_registry,
} from '@pioneering/modu-agent'
import { authGuard } from '../plugins/auth.js'

/** 可观测性设置（响应/请求体，PUT 时字段可部分提供）。 */
export interface ObservabilitySettings {
  tracingEnabled: boolean
  metricsEnabled: boolean
  structuredLogging: boolean
  otlpEndpoint: string
  serviceName: string
  samplingRate: number
  prometheusPort: number
  metricsPath: string
}

function readSettings(): ObservabilitySettings {
  const config = getConfig()
  return {
    tracingEnabled: Boolean(
      config.get('observability.tracing.enabled', false),
    ),
    metricsEnabled: Boolean(
      config.get('observability.metrics.enabled', false),
    ),
    structuredLogging: Boolean(
      config.get('observability.logging.structured', false),
    ),
    otlpEndpoint: String(
      config.get('observability.tracing.otlp_endpoint', '') ?? '',
    ),
    serviceName: String(
      config.get('observability.tracing.service_name', 'modu-agent') ??
        'modu-agent',
    ),
    samplingRate: Number(
      config.get('observability.tracing.sampling_rate', 0.1),
    ),
    prometheusPort: Number(
      config.get('observability.metrics.prometheus_port', 9090),
    ),
    metricsPath: String(
      config.get('observability.metrics.path', '/metrics') ?? '/metrics',
    ),
  }
}

/** 构造带 HTTP 状态码的错误。 */
function httpError(
  statusCode: number,
  message: string,
): Error & { statusCode: number } {
  const err = new Error(message) as Error & { statusCode: number }
  err.statusCode = statusCode
  return err
}

export const observabilityRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.register(async (app) => {
    // 所有可观测性端点强制认证（对齐 agent/chat 路由；
    // Prometheus 抓取可在其 scrape config 中带 Bearer token）
    app.addHook('preHandler', authGuard)

    // GET /observability/settings
    app.get(
      '/observability/settings',
      {
        schema: {
          tags: ['observability'],
          summary: '查看可观测性开关与导出配置',
          security: [{ BearerAuth: [] }],
        },
      },
      async () => readSettings(),
    )

    // PUT /observability/settings
    app.put(
      '/observability/settings',
      {
        schema: {
          tags: ['observability'],
          summary: '更新可观测性开关（tracing/metrics/结构化日志）',
          security: [{ BearerAuth: [] }],
        },
      },
      async (req) => {
        const body = (req.body ?? {}) as Partial<ObservabilitySettings>
        const config = getConfig()

        if (typeof body.tracingEnabled === 'boolean') {
          config.set(
            'observability.tracing.enabled',
            body.tracingEnabled,
          )
        }
        if (typeof body.structuredLogging === 'boolean') {
          config.set(
            'observability.logging.structured',
            body.structuredLogging,
          )
        }
        if (typeof body.otlpEndpoint === 'string') {
          config.set(
            'observability.tracing.otlp_endpoint',
            body.otlpEndpoint,
          )
        }

        // metrics 开关：更新配置后重置单例，使其按最新开关重建
        // （启用 → 下一次取用初始化 prom-client；停用 → 退化为 no-op）。
        if (typeof body.metricsEnabled === 'boolean') {
          if (
            body.metricsEnabled !==
            Boolean(config.get('observability.metrics.enabled', false))
          ) {
            config.set(
              'observability.metrics.enabled',
              body.metricsEnabled,
            )
            reset_metrics_registry()
          }
        }

        return readSettings()
      },
    )

    // GET /observability/metrics —— Prometheus exposition 文本
    app.get(
      '/observability/metrics',
      {
        schema: {
          tags: ['observability'],
          summary: '以 Prometheus exposition 格式导出指标',
        },
      },
      async (_req, reply) => {
        const config = getConfig()
        // 配置关闭 → 立即 503，无需等待
        if (!config.get('observability.metrics.enabled', false)) {
          throw httpError(
            503,
            'metrics 未启用：在 PUT /observability/settings 中设置 metricsEnabled=true',
          )
        }

        const registry = get_metrics_registry()
        // 配置已启用但单例为异步初始化 → 短暂等待其就绪
        const deadline = Date.now() + 2000
        while (!registry.enabled && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 10))
        }

        if (!registry.enabled) {
          throw httpError(503, 'metrics 初始化未完成，请稍后重试')
        }

        const text = await registry.collect_text_async()
        reply
          .type('text/plain; version=0.0.4; charset=utf-8')
          .send(text)
      },
    )
  })
}
