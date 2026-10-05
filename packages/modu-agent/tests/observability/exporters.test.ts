// P1-25：Prometheus 端点默认仅绑定 loopback（127.0.0.1）。
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'

import {
  start_prometheus_server,
  stop_prometheus_server,
  reset_exporters,
} from '@/observability/exporters.js'
import { MetricsRegistry } from '@/observability/metrics.js'

const PORT = 9123

/**
 * T2-3：`prom-client` 是 optionalDependency（package.json:37），未安装时
 * MetricsRegistry 构造期即降级为 no-op，指标文本恒为空 → 断言必然失败。
 * 这属于"环境缺可选依赖"而非代码缺陷，故按依赖可用性跳过；
 * 装了 prom-client 的环境（含完整 CI）仍会真实执行这些断言。
 */
async function promClientAvailable(): Promise<boolean> {
  try {
    const mod: any = await import(/* @vite-ignore */ 'prom-client')
    return Boolean(mod?.register ?? mod?.default?.register)
  } catch {
    return false
  }
}

afterEach(() => {
  reset_exporters()
})

describe('P1-25 · Prometheus 端点 loopback 绑定', () => {
  it('默认启动仅监听 127.0.0.1，且 /metrics 可从 loopback 取回', async () => {
    if (!(await promClientAvailable())) {
      console.warn('[skip] prom-client 未安装（optionalDependency），跳过 Prometheus 端点断言')
      return
    }
    const registry = new MetricsRegistry(true)
    await new Promise((r) => setTimeout(r, 20))
    registry.record_request('success', 0.01)

    const server = await start_prometheus_server(PORT, '/metrics', registry.registry)
    expect(server).not.toBeNull()

    // 实际监听地址必须是 loopback（而非 0.0.0.0 / :: 全网卡）
    const addr = server.address()
    expect(addr).toBeTruthy()
    expect(typeof addr === 'object' ? addr.address : '').toBe('127.0.0.1')

    // loopback 可访问且返回指标文本
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${PORT}/metrics`, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve(data))
      }).on('error', reject)
    })
    expect(body).toContain('modu_requests_total')

    stop_prometheus_server()
  })

  it('显式传 host 时按传入地址监听（opt-in 全网卡）', async () => {
    if (!(await promClientAvailable())) {
      console.warn('[skip] prom-client 未安装（optionalDependency），跳过 host 绑定断言')
      return
    }
    const registry = new MetricsRegistry(true)
    await new Promise((r) => setTimeout(r, 20))
    const server = await start_prometheus_server(PORT + 1, '/metrics', registry.registry, '0.0.0.0')
    expect(server).not.toBeNull()
    const addr = server.address()
    // Node 在双栈系统可能报告 0.0.0.0 或 ::，二者均为显式全网卡（非 loopback）
    const bound = typeof addr === 'object' ? addr.address : ''
    expect(['0.0.0.0', '::']).toContain(bound)
    stop_prometheus_server()
  })
})
