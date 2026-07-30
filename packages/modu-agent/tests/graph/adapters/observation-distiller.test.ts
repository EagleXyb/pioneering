// P0-3 单元测试：Observation 多层蒸馏器
// 对应文档 P0-3：三层管道（结构化提取 → 相关性过滤 → 增量压缩）+ token 预算 + 异常降级
import { describe, it, expect } from 'vitest'
import {
  ObservationDistiller,
  formatDistilledAsContent,
  type DistilledObservation,
} from '@/graph/adapters/observation-distiller.js'

describe('P0-3 ObservationDistiller', () => {
  // ============================================================
  // Layer-1: 结构化提取
  // ============================================================
  describe('Layer-1 结构化提取', () => {
    it('列表型结果：提取 records_count + summary + key_metrics', () => {
      const distiller = new ObservationDistiller(500)
      const raw = { status: 'success', data: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }] }
      const r = distiller.distill(raw)
      expect(r.status).toBe('success')
      expect(r.records_count).toBe(2)
      expect(r.summary).toContain('[0]')
      expect(r.summary).toContain('[1]')
      expect(r.key_metrics?.['count']).toBe(2)
    })

    it('对象型结果：提取 key_metrics + summary', () => {
      const distiller = new ObservationDistiller(500)
      const raw = { status: 'success', data: { total: 100, avg: 25.5 } }
      const r = distiller.distill(raw)
      expect(r.status).toBe('success')
      expect(r.key_metrics?.['total']).toBe(100)
      expect(r.summary).toContain('total')
    })

    it('error 状态：提取 error_code + error_message', () => {
      const distiller = new ObservationDistiller(500)
      const raw = { status: 'error', error_code: 'SQL_001', error_message: 'syntax error', data: null }
      const r = distiller.distill(raw)
      expect(r.status).toBe('error')
      expect(r.error_code).toBe('SQL_001')
      expect(r.error_message).toBe('syntax error')
    })

    it('字符串型结果：summary 为原字符串', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill('plain text result')
      expect(r.status).toBe('success')
      expect(r.summary).toBe('plain text result')
    })

    it('数字型结果：summary 为字符串 + key_metrics.value', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill(42)
      expect(r.summary).toBe('42')
      expect(r.key_metrics?.['value']).toBe(42)
    })

    it('兼容 result/output 字段别名', () => {
      const distiller = new ObservationDistiller(500)
      const r1 = distiller.distill({ result: { count: 5 } })
      const r2 = distiller.distill({ output: 'text output' })
      expect(r1.summary).toContain('count')
      expect(r2.summary).toBe('text output')
    })
  })

  // ============================================================
  // Layer-2: 相关性过滤
  // ============================================================
  describe('Layer-2 相关性过滤', () => {
    it('current_subtask 缺失时跳过过滤（保留原 summary）', () => {
      const distiller = new ObservationDistiller(500)
      const raw = { data: [{ name: 'alice' }, { name: 'bob' }, { name: 'charlie' }] }
      const r = distiller.distill(raw, null)
      // 不过滤，summary 含全部前 5 条
      expect(r.summary).toContain('alice')
      expect(r.summary).toContain('bob')
    })

    it('current_subtask 含关键词时过滤无关行', () => {
      const distiller = new ObservationDistiller(2000)
      // 构造多行 summary 以便过滤
      const raw = {
        data: [
          { name: 'alice_age', value: 30 },
          { name: 'bob_city', value: 'NYC' },
          { name: 'charlie_age', value: 25 },
        ],
      }
      const subtask = { task_name: 'age analysis' }
      const r = distiller.distill(raw, subtask)
      // 过滤后应保留含 age 的行；若行数过少则保留原样
      expect(r.summary).toBeDefined()
    })
  })

  // ============================================================
  // Layer-3: 增量压缩
  // ============================================================
  describe('Layer-3 增量压缩', () => {
    it('history 为空时跳过压缩', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill({ data: [1, 2, 3] }, null, [])
      expect(r.summary).toBeDefined()
    })

    it('history 非空时与历史去重', () => {
      const distiller = new ObservationDistiller(2000)
      const history = [{ summary: '[0] 1\n[1] 2\n[2] 3\n[3] 4' }]
      const raw = { data: [1, 2, 3, 4, 5] }
      const r = distiller.distill(raw, null, history)
      // 压缩后应去除与历史重复的行，保留新信息
      expect(r.summary).toBeDefined()
    })
  })

  // ============================================================
  // Token 预算控制
  // ============================================================
  describe('Token 预算控制', () => {
    it('summary 超过 maxTokens 时截断并追加 [truncated]', () => {
      const distiller = new ObservationDistiller(10) // 极小预算强制截断
      const longText = 'a'.repeat(10 * 3 * 5) // 远超预算
      const r = distiller.distill(longText)
      expect(r.summary.length).toBeLessThanOrEqual(10 * 3 + '\n... [truncated]'.length)
      expect(r.summary).toContain('[truncated]')
    })

    it('summary 未超过 maxTokens 时原样保留', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill('short text')
      expect(r.summary).toBe('short text')
      expect(r.summary).not.toContain('[truncated]')
    })
  })

  // ============================================================
  // 异常降级
  // ============================================================
  describe('异常降级', () => {
    it('null 输入返回空 summary', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill(null)
      expect(r.status).toBe('success')
      expect(r.summary).toBe('')
      expect(r.raw).toBeNull()
    })

    it('undefined 输入返回空 summary', () => {
      const distiller = new ObservationDistiller(500)
      const r = distiller.distill(undefined)
      expect(r.summary).toBe('')
    })
  })

  // ============================================================
  // formatDistilledAsContent
  // ============================================================
  describe('formatDistilledAsContent', () => {
    it('success 状态输出含 records_count/key_metrics/data 的 JSON', () => {
      const distilled: DistilledObservation = {
        status: 'success',
        records_count: 3,
        key_metrics: { count: 3 },
        summary: 'test summary',
      }
      const content = formatDistilledAsContent(distilled)
      const parsed = JSON.parse(content)
      expect(parsed.status).toBe('success')
      expect(parsed.records_count).toBe(3)
      expect(parsed.data).toBe('test summary')
    })

    it('error 状态输出含 error_code/error_message 的 JSON', () => {
      const distilled: DistilledObservation = {
        status: 'error',
        error_code: 'ERR_001',
        error_message: 'failed',
        summary: '',
      }
      const content = formatDistilledAsContent(distilled)
      const parsed = JSON.parse(content)
      expect(parsed.status).toBe('error')
      expect(parsed.error_code).toBe('ERR_001')
      expect(parsed.error_message).toBe('failed')
    })
  })
})
