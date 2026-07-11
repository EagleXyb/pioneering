import { describe, it, expect } from 'vitest'
import { RollbackMechanism } from '@/evolution/rollback-mechanism.js'

class FakeStore {
  private _snap: Record<string, any> | null
  constructor(snapshot: Record<string, any> | null) {
    this._snap = snapshot
  }
  getVersion(_name: string, _version: string): Record<string, any> | null {
    return this._snap
  }
}

class FakeRegistry {
  swapped = 0
  swapComponent(_cat: string, _name: string, _comp: any): boolean {
    this.swapped += 1
    return true
  }
}

describe('RollbackMechanism', () => {
  it('rolls back to a stable version when quality drops below threshold', () => {
    const store = new FakeStore({ category: 'tool', component: { name: () => 'stable' } })
    const reg = new FakeRegistry()
    const rb = new RollbackMechanism(store as any, reg as any, 0.7)

    // First record a good version so a stable candidate exists.
    rb.recordAndCheck('comp', 'good', 0.9)
    // Then a bad version that triggers rollback.
    const rolled = rb.recordAndCheck('comp', 'bad', 0.1)

    expect(rolled).toBe(true)
    expect(reg.swapped).toBe(1)
    expect(rb.getRollbackCount()).toBe(1)
  })

  it('records quality history', () => {
    const store = new FakeStore({ category: 'tool', component: {} })
    const reg = new FakeRegistry()
    const rb = new RollbackMechanism(store as any, reg as any, 0.7)
    rb.recordAndCheck('comp', 'v1', 0.9)
    rb.recordAndCheck('comp', 'v2', 0.1)
    const history = rb.getQualityHistory('comp')
    expect(history.length).toBe(2)
    expect(history[0]).toEqual(['v1', 0.9])
  })

  it('does not roll back when no stable version exists', () => {
    const store = new FakeStore({ category: 'tool', component: {} })
    const reg = new FakeRegistry()
    const rb = new RollbackMechanism(store as any, reg as any, 0.7)
    const rolled = rb.recordAndCheck('comp', 'only', 0.1)
    expect(rolled).toBe(false)
    expect(reg.swapped).toBe(0)
  })
})
