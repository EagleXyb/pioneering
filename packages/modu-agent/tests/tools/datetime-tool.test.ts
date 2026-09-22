import { describe, it, expect } from 'vitest'
import { DateTimeTool } from '@/tools/datetime-tool.js'

describe('DateTimeTool', () => {
  const tool = new DateTimeTool()

  it('returns its name', () => {
    expect(tool.name()).toBe('datetime')
  })

  it('returns current time for a known timezone', () => {
    const r = tool.invoke({ op: 'now', timezone: 'UTC' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.timezone).toBe('UTC')
    expect(r.data.unix_timestamp).toBeTypeOf('number')
  })

  it('unix_timestamp 是真实 epoch 秒（不受宿主机时区影响）', () => {
    const before = Math.floor(Date.now() / 1000)
    const r = tool.invoke({ op: 'now', timezone: 'UTC' }, {}) as any
    const after = Math.floor(Date.now() / 1000)
    // 回归：原实现会叠加宿主机 getTimezoneOffset()，东八区会偏差 8 小时
    expect(r.data.unix_timestamp).toBeGreaterThanOrEqual(before - 5)
    expect(r.data.unix_timestamp).toBeLessThanOrEqual(after + 5)
  })

  it('iso / datetime 反映目标时区挂钟时间', () => {
    const r = tool.invoke({ op: 'now', timezone: 'CST' }, {}) as any
    expect(r.status).toBe('success')
    // CST 在时区表中为 +8：挂钟小时应等于 UTC 小时 + 8（模 24）
    const d = new Date()
    const expectedHour = (d.getUTCHours() + 8) % 24
    const actualHour = Number(String(r.data.iso).slice(11, 13))
    expect(actualHour).toBe(expectedHour)
    expect(String(r.data.datetime)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('errors on unknown timezone', () => {
    const r = tool.invoke({ op: 'now', timezone: 'ZZZ' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('DT_003')
  })

  it('converts between timezones (UTC -> CST = +8h)', () => {
    const r = tool.invoke(
      {
        op: 'convert',
        datetime_str: '2023-01-01 12:00:00',
        source_timezone: 'UTC',
        target_timezone: 'CST',
      },
      {},
    ) as any
    expect(r.status).toBe('success')
    expect(r.data.offset_diff_hours).toBe(8)
  })

  it('parses a datetime string', () => {
    const r = tool.invoke({ op: 'parse', datetime_str: '2023-01-01 12:00:00' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.year).toBe(2023)
    expect(r.data.hour).toBe(12)
  })

  it('errors on unknown op', () => {
    const r = tool.invoke({ op: 'frobnicate' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('DT_001')
  })
})
