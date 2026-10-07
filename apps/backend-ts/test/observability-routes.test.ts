/**
 * 可观测性路由单元测试（T5.4）：
 *   GET  /observability/settings
 *   PUT  /observability/settings
 *   GET  /observability/metrics
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  // 以 DEFAULT_CONFIG 观测默认值为种子的可变小配置
  const seed = {
    observability: {
      tracing: {
        enabled: false,
        otlp_endpoint: '',
        service_name: 'modu-agent',
        sampling_rate: 0.1,
      },
      metrics: { enabled: false, prometheus_port: 9090, path: '/metrics' },
      logging: { structured: false, level: 'INFO' },
    },
  }
  const state: { data: any } = { data: structuredClone(seed) }

  function getByPath(obj: any, dotted: string): any {
    return dotted.split('.').reduce((cur, k) => cur?.[k], obj)
  }
  function setByPath(obj: any, dotted: string, value: any): void {
    const keys = dotted.split('.')
    const parent = keys.slice(0, -1).reduce((cur, k) => cur[k], obj)
    parent[keys[keys.length - 1]] = value
  }

  const registry: {
    enabled: boolean
    text: string
  } = { enabled: false, text: '' }

  return { state, getByPath, setByPath, registry }
})

vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({
    get: (key: string, fallback?: unknown) => {
      const v = mocks.getByPath(mocks.state.data, key)
      return v === undefined ? fallback : v
    },
    set: (key: string, value: unknown) =>
      mocks.setByPath(mocks.state.data, key, value),
  }),
  get_metrics_registry: () => ({
    get enabled() {
      return mocks.registry.enabled
    },
    collect_text_async: async () => mocks.registry.text,
  }),
  reset_metrics_registry: () => {
    // 模拟单例按最新开关重建：config metrics.enabled=true → enabled registry
    mocks.registry.enabled = Boolean(
      mocks.getByPath(mocks.state.data, 'observability.metrics.enabled'),
    )
  },
}))

// handler 逻辑测试：mock 认证守卫注入已认证用户（401 强制由 management-auth 覆盖）
vi.mock('../src/plugins/auth.js', () => ({
  authGuard: async (req: { user?: unknown }) => {
    req.user = { id: 'test-user' }
  },
}))

import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { observabilityRoutes } from '../src/routes/observability.js'
import { responseWrapperPlugin } from '../src/plugins/response-wrapper.js'

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify()
  await app.register(responseWrapperPlugin)
  await app.register(observabilityRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.data = {
    observability: {
      tracing: {
        enabled: false,
        otlp_endpoint: '',
        service_name: 'modu-agent',
        sampling_rate: 0.1,
      },
      metrics: { enabled: false, prometheus_port: 9090, path: '/metrics' },
      logging: { structured: false, level: 'INFO' },
    },
  }
  mocks.registry.enabled = false
  mocks.registry.text = ''
})

describe('GET /observability/settings', () => {
  it('返回当前开关与导出配置（默认全关）', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'GET',
      url: '/observability/settings',
    })

    expect(reply.json().data).toMatchObject({
      tracingEnabled: false,
      metricsEnabled: false,
      structuredLogging: false,
      otlpEndpoint: '',
      serviceName: 'modu-agent',
      samplingRate: 0.1,
      prometheusPort: 9090,
      metricsPath: '/metrics',
    })
  })
})

describe('PUT /observability/settings', () => {
  it('开启 tracing 并设置 OTLP endpoint', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/observability/settings',
      payload: {
        tracingEnabled: true,
        otlpEndpoint: 'http://localhost:4317',
      },
    })

    expect(reply.json().data).toMatchObject({
      tracingEnabled: true,
      otlpEndpoint: 'http://localhost:4317',
    })
  })

  it('开启 metrics 时重置单例（启用 registry）', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/observability/settings',
      payload: { metricsEnabled: true },
    })

    expect(reply.json().data).toMatchObject({ metricsEnabled: true })
    // reset_metrics_registry 使单例按最新配置变为 enabled
    expect(mocks.registry.enabled).toBe(true)
  })

  it('关闭 metrics 时重置单例（退化为 no-op）', async () => {
    mocks.state.data.observability.metrics.enabled = true
    mocks.registry.enabled = true

    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/observability/settings',
      payload: { metricsEnabled: false },
    })

    expect(reply.json().data).toMatchObject({ metricsEnabled: false })
    expect(mocks.registry.enabled).toBe(false)
  })

  it('可开启结构化日志', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'PUT',
      url: '/observability/settings',
      payload: { structuredLogging: true },
    })

    expect(reply.json().data).toMatchObject({ structuredLogging: true })
  })
})

describe('GET /observability/metrics', () => {
  it('metrics 启用时返回 Prometheus 文本（未被响应包装）', async () => {
    mocks.state.data.observability.metrics.enabled = true
    mocks.registry.enabled = true
    mocks.registry.text = [
      '# HELP modu_requests_total Total requests',
      '# TYPE modu_requests_total counter',
      'modu_requests_total{status="success"} 3',
    ].join('\n')

    const app = await buildServer()
    const reply = await app.inject({
      method: 'GET',
      url: '/observability/metrics',
    })

    expect(reply.statusCode).toBe(200)
    expect(reply.headers['content-type']).toContain(
      'text/plain; version=0.0.4',
    )
    expect(reply.body).toContain('modu_requests_total')
    expect(reply.body).toContain('3')
    // 未被 { code, data, message } 包裹
    expect(reply.body.startsWith('# HELP')).toBe(true)
  })

  it('metrics 未启用时返回 503', async () => {
    const app = await buildServer()
    const reply = await app.inject({
      method: 'GET',
      url: '/observability/metrics',
    })

    expect(reply.statusCode).toBe(503)
    expect(reply.body).toContain('metrics 未启用')
  })
})
