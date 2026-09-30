import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { VersionedComponentStore } from '@/evolution/versioned-store.js'

describe('VersionedComponentStore', () => {
  let dir: string
  let store: VersionedComponentStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'modu-versions-'))
    store = new VersionedComponentStore(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('saves and retrieves a version (in-memory cache returns the instance)', () => {
    const instance = { _apiKey: 'k', name: () => 'x' }
    store.saveVersion('comp', 'v1', { a: 1 }, { note: 'first' }, 'tool', instance)
    const got = store.getVersion('comp', 'v1')
    expect(got).not.toBeNull()
    expect(got!.category).toBe('tool')
    expect(got!.component).toBe(instance)
  })

  it('lists versions and latest version', () => {
    store.saveVersion('comp', 'v1', {}, {}, 'tool', {})
    store.saveVersion('comp', 'v2', {}, {}, 'tool', {})
    expect(store.listVersions('comp').sort()).toEqual(['v1', 'v2'])
    expect(store.getLatestVersion('comp')).toBe('v2')
  })

  it('returns null for a missing version', () => {
    expect(store.getVersion('comp', 'nope')).toBeNull()
  })

  it('serializes init params from instance properties', () => {
    const instance = { _apiKey: 'secret', _model: 'gpt' }
    store.saveVersion('comp', 'v1', {}, {}, 'tool', instance)
    const got = store.getVersion('comp', 'v1')!
    // init_params are recovered from the serialized config snapshot
    expect(got.component_config.init_params.apiKey).toBe('secret')
  })
})

// ============================================================
// P1-8：FIFO 有界版本淘汰
// ============================================================
describe('P1-8 · VersionedComponentStore FIFO 有界', () => {
  let dir: string
  let store: VersionedComponentStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'modu-versions-cap-'))
    store = new VersionedComponentStore(dir, 3)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('上限为 3：写入 5 个版本后仅保留最新 3 个（索引 + 文件 + 缓存同步淘汰）', () => {
    const instances: Record<string, { v: string }> = {}
    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      instances[v] = { v }
      store.saveVersion('comp', v, { ver: v }, {}, 'tool', instances[v])
    }

    expect(store.listVersions('comp')).toEqual(['v3', 'v4', 'v5'])
    expect(store.getLatestVersion('comp')).toBe('v5')

    // 最旧两版文件与缓存已不可取回
    expect(store.getVersion('comp', 'v1')).toBeNull()
    expect(store.getVersion('comp', 'v2')).toBeNull()

    // 保留版本文件存在，且缓存实例仍可取回
    const v3 = store.getVersion('comp', 'v3')
    expect(v3).not.toBeNull()
    expect(v3!.component).toBe(instances['v3'])
    expect(store.getVersion('comp', 'v5')!.component).toBe(instances['v5'])
  })

  it('恰达上限不淘汰；重复保存同一版本不挤占配额', () => {
    store.saveVersion('comp', 'v1', {}, {}, 'tool', { x: 1 })
    store.saveVersion('comp', 'v2', {}, {}, 'tool', { x: 2 })
    store.saveVersion('comp', 'v3', {}, {}, 'tool', { x: 3 })
    expect(store.listVersions('comp')).toHaveLength(3)

    // 重复保存 v3（索引已包含，不新增条目也不触发淘汰）
    store.saveVersion('comp', 'v3', { updated: true }, {}, 'tool', { x: 33 })
    expect(store.listVersions('comp')).toEqual(['v1', 'v2', 'v3'])
  })

  it('不同组件的版本计数互不影响', () => {
    store.saveVersion('a', 'a1', {}, {}, 't', {})
    store.saveVersion('a', 'a2', {}, {}, 't', {})
    store.saveVersion('a', 'a3', {}, {}, 't', {})
    store.saveVersion('a', 'a4', {}, {}, 't', {})
    store.saveVersion('b', 'b1', {}, {}, 't', {})

    expect(store.listVersions('a')).toEqual(['a2', 'a3', 'a4'])
    expect(store.listVersions('b')).toEqual(['b1'])
  })

  it('非法上限构造抛 RangeError；默认上限为 20', () => {
    expect(() => new VersionedComponentStore(dir, 0)).toThrow(RangeError)
    expect(() => new VersionedComponentStore(dir, -3)).toThrow(RangeError)
    expect(VersionedComponentStore.DEFAULT_MAX_VERSIONS_PER_COMPONENT).toBe(20)
  })
})
