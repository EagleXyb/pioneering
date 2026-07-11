import { describe, it, expect } from 'vitest'
import { ServerLifecycleManager } from '@/mcp/lifecycle.js'

describe('ServerLifecycleManager', () => {
  it('tracks and reports server tracking state', () => {
    const m = new ServerLifecycleManager()
    expect(m.isTracked('s1')).toBe(false)
    m.track('s1')
    expect(m.isTracked('s1')).toBe(true)
    expect(m.trackedServers['s1']).toBe(true)
  })

  it('stops a single server and all servers', async () => {
    const m = new ServerLifecycleManager()
    m.track('s1')
    m.track('s2')
    await m.stopServer('s1')
    expect(m.isTracked('s1')).toBe(false)
    expect(m.isTracked('s2')).toBe(true)
    await m.stopAll()
    expect(m.trackedServers).toEqual({})
  })
})
