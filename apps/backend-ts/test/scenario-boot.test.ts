/**
 * activateConfiguredPacks 单元测试（T5.3）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const activate = vi.fn()
  const isActive = vi.fn(() => false)
  const state: { packs: string[] } = { packs: [] }
  return { activate, isActive, state }
})

vi.mock('@pioneering/modu-agent', () => ({
  getConfig: () => ({
    get: (key: string, fallback?: unknown) =>
      key === 'scenario.packs' ? mocks.state.packs : fallback,
  }),
  getScenarioLoader: () => ({
    activate: mocks.activate,
    isActive: mocks.isActive,
  }),
}))

import { activateConfiguredPacks } from '../src/core/scenario-boot.js'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.packs = []
  mocks.isActive.mockReturnValue(false)
})

describe('activateConfiguredPacks（T5.3）', () => {
  it('未配置时返回空、不调用 loader', async () => {
    expect(await activateConfiguredPacks()).toEqual([])
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('逐个激活配置包并返回成功名', async () => {
    mocks.state.packs = ['research-pack', 'planning-pack']
    mocks.activate.mockResolvedValue(undefined)

    expect(await activateConfiguredPacks()).toEqual([
      'research-pack',
      'planning-pack',
    ])
    expect(mocks.activate).toHaveBeenNthCalledWith(1, 'research-pack')
    expect(mocks.activate).toHaveBeenNthCalledWith(2, 'planning-pack')
  })

  it('已激活的包计入结果但不重复激活', async () => {
    mocks.state.packs = ['research-pack']
    mocks.isActive.mockReturnValue(true)

    expect(await activateConfiguredPacks()).toEqual(['research-pack'])
    expect(mocks.activate).not.toHaveBeenCalled()
  })

  it('单个包激活失败被隔离，其余包仍激活（不抛出）', async () => {
    mocks.state.packs = ['bad-pack', 'planning-pack']
    mocks.activate
      .mockRejectedValueOnce(new Error('pack not found'))
      .mockResolvedValueOnce(undefined)

    await expect(activateConfiguredPacks()).resolves.toEqual(['planning-pack'])
  })
})
