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
