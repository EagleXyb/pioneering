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
