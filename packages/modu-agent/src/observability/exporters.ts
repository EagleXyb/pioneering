// 对应 Python: observability/exporters.py
// OTLP / Prometheus exporter 配置模块
// 提供configure_otlp_exporter和start_prometheus_server
import { get_metrics_registry } from './metrics.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[exporters] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[exporters] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[exporters] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[exporters] ${msg}`, ...args),
}

// 防止重复配置
let _otlp_configured = false
let _otlp_lock = false

// 持有 prometheus_server 实例引用，避免被 GC
let _prometheus_server: any = null
let _prometheus_lock = false

/**
 * 配置 OTLP gRPC exporter，将 OTel span 导出到指定 endpoint。
 *
 * 内部会创建 OTLPSpanExporter + BatchSpanProcessor，
 * 并添加到全局 TracerProvider。
 *
 * Args:
 *   endpoint: OTLP gRPC endpoint（如 "http://localhost:4317"）
 *   service_name: 服务名（用于日志，实际 service.name 在 TracerProvider 初始化时设置）
 *
 * Returns:
 *   true=配置成功，false=配置失败或已配置
 */
export async function configure_otlp_exporter(
  endpoint: string,
  service_name: string = 'modu-agent',
): Promise<boolean> {
  if (!endpoint) {
    logger.debug('configure_otlp_exporter: endpoint empty, skipping')
    return false
  }

  if (_otlp_lock) {
    // 等待前一个配置完成（简单的忙等待降级）
    logger.debug('configure_otlp_exporter: concurrent call, skipping')
    return _otlp_configured
  }

  _otlp_lock = true
  try {
    if (_otlp_configured) {
      logger.debug('configure_otlp_exporter: already configured, skipping')
      return true
    }

    // OTel exporter 包未在 package.json 中声明，使用动态 import + try/catch 降级
    try {
      const otelApi = await import('@opentelemetry/api')
      // 尝试 OTLP gRPC exporter
      let otlpExporterModule: any
      try {
        otlpExporterModule = await import('@opentelemetry/exporter-trace-otlp-grpc')
      } catch {
        // 降级到 HTTP exporter
        try {
          otlpExporterModule = await import('@opentelemetry/exporter-trace-otlp-http')
        } catch {
          logger.warning(
            'configure_otlp_exporter: opentelemetry-exporter-otlp not installed',
          )
          return false
        }
      }

      const sdkTraceExport = await import('@opentelemetry/sdk-trace-base')
      const sdkTrace = await import('@opentelemetry/sdk-trace-base')
      const sdkResources = await import('@opentelemetry/resources')

      const Resource = sdkResources.Resource ?? sdkResources.default?.Resource
      const TracerProvider = sdkTrace.TracerProvider ?? sdkTrace.default?.TracerProvider
      const BatchSpanProcessor = sdkTraceExport.BatchSpanProcessor ?? sdkTraceExport.default?.BatchSpanProcessor

      let provider = otelApi.trace.getTracerProvider()

      // 检查 provider 是否是 SDK 的 TracerProvider
      const isSdkProvider = provider instanceof TracerProvider ||
        (provider && provider.constructor && provider.constructor.name === 'TracerProvider')

      if (!isSdkProvider) {
        // 可能 tracing 未启用或 provider 是默认 ProxyTracerProvider
        // 尝试创建一个新的 TracerProvider
        const resource = Resource.create({ 'service.name': service_name })
        const newProvider = new TracerProvider({ resource })
        try {
          otelApi.trace.setTracerProvider(newProvider)
        } catch {
          // 已设置过 provider，复用现有
        }
        provider = otelApi.trace.getTracerProvider()
        const stillNotSdk = !(provider instanceof TracerProvider) &&
          !(provider && provider.constructor && provider.constructor.name === 'TracerProvider')
        if (stillNotSdk) {
          logger.warning(
            'configure_otlp_exporter: cannot attach span processor ' +
            'to provider %s (tracing may not be enabled)',
            provider?.constructor?.name ?? 'unknown',
          )
          return false
        }
      }

      // 创建 exporter
      const OTLPSpanExporter = otlpExporterModule.OTLPSpanExporter ??
        otlpExporterModule.default?.OTLPSpanExporter
      const exporter = new OTLPSpanExporter({ url: endpoint })

      const spanProcessor = new BatchSpanProcessor(exporter, {
        maxQueueSize: 512,
        scheduledDelayMillis: 5000,
        maxExportBatchSize: 128,
      })
      provider.addSpanProcessor(spanProcessor)

      _otlp_configured = true
      logger.info(
        'OTLP exporter configured: endpoint=%s service=%s',
        endpoint, service_name,
      )
      return true
    } catch (e) {
      logger.warning(
        'configure_otlp_exporter: configuration failed: %s',
        String(e),
      )
      return false
    }
  } finally {
    _otlp_lock = false
  }
}

/**
 * 启动 Prometheus HTTP endpoint，暴露 metrics。
 *
 * 启动后访问 ``http://localhost:{port}{path}`` 可获取 Prometheus exposition 格式的指标。
 *
 * Args:
 *   port: HTTP 端口（默认 9090）
 *   path: URL 路径（默认 "/metrics"）
 *   registry: prom-client Registry 实例。null=使用 MetricsRegistry 的 registry。
 *
 * Returns:
 *   http.Server 实例（成功时），null=启动失败（如端口被占用）
 *
 * Note:
 *   - 在同一进程内只能启动一个 prometheus_server，重复调用返回 null。
 *   - 测试环境下建议用 ``registry.metrics()`` 直接读取，而非启动 HTTP server。
 */
export async function start_prometheus_server(
  port: number = 9090,
  path: string = '/metrics',
  registry?: any | null,
): Promise<any | null> {
  if (_prometheus_lock) {
    logger.debug('start_prometheus_server: concurrent call, skipping')
    return _prometheus_server
  }

  _prometheus_lock = true
  try {
    if (_prometheus_server !== null) {
      logger.debug('start_prometheus_server: already running, skipping')
      return _prometheus_server
    }

    // 确定使用的 registry
    let reg = registry ?? null
    if (reg === null) {
      try {
        const metricsRegistry = get_metrics_registry()
        reg = metricsRegistry.registry
      } catch {
        // ignore
      }
    }

    if (reg === null) {
      logger.warning(
        'start_prometheus_server: no metrics registry available ' +
        '(metrics may be disabled)',
      )
      return null
    }

    // 使用 Node 内置 http 模块创建 Prometheus exposition endpoint
    const http = await import('http')

    const server = http.createServer(async (req: any, res: any) => {
      const url = req.url ?? ''
      if (url === path || url === path + '/') {
        try {
          const metricsText = await reg.metrics()
          res.writeHead(200, {
            'Content-Type': reg.contentType ?? 'text/plain; version=0.0.4',
          })
          res.end(metricsText)
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end(`Error collecting metrics: ${String(e)}`)
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
      }
    })

    return new Promise((resolve) => {
      server.on('error', (e: any) => {
        if (e.code === 'EADDRINUSE') {
          logger.warning(
            'start_prometheus_server: port %d unavailable: %s',
            port, String(e),
          )
        } else {
          logger.warning(
            'start_prometheus_server: start failed: %s',
            String(e),
          )
        }
        _prometheus_lock = false
        resolve(null)
      })

      server.listen(port, () => {
        _prometheus_server = server
        logger.info(
          'Prometheus server started: port=%d path=%s',
          port, path,
        )
        _prometheus_lock = false
        resolve(server)
      })
    })
  } catch (e) {
    logger.warning(
      'start_prometheus_server: start failed: %s',
      String(e),
    )
    _prometheus_lock = false
    return null
  }
}

/**
 * 停止 Prometheus HTTP server（测试清理用）。
 */
export function stop_prometheus_server(): void {
  if (_prometheus_server === null) {
    return
  }

  try {
    const server = _prometheus_server
    if (typeof server.close === 'function') {
      server.close()
    }
  } catch (e) {
    logger.debug('stop_prometheus_server: %s', String(e))
  }

  _prometheus_server = null
}

/**
 * 重置所有 exporter 状态（测试清理用）。
 *
 * 同时停止 prometheus server 并重置 OTLP 配置标志。
 */
export function reset_exporters(): void {
  stop_prometheus_server()
  _otlp_configured = false
}
