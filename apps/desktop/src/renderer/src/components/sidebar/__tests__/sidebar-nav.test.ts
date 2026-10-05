// T18 回归测试：导航占位标记必须与页面实际实现一致
import { describe, it, expect } from 'vitest'
import { NAV_ITEMS } from '@renderer/components/sidebar/SidebarNav'

describe('SidebarNav placeholder 标记（T18）', () => {
  const flags = Object.fromEntries(NAV_ITEMS.map((i) => [i.key, i.placeholder]))

  it('插件市场 / 自动化为完整实现页：placeholder=false', () => {
    expect(flags.plugins).toBe(false)
    expect(flags.automation).toBe(false)
  })

  it('助理 / 我的文件 / 更多 为占位页：placeholder=true', () => {
    expect(flags.assistant).toBe(true)
    expect(flags['my-files']).toBe(true)
    expect(flags.more).toBe(true)
  })
})
