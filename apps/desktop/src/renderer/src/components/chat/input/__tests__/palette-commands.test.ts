// T11 回归测试：斜杠命令注册表不得保留无执行器的死命令
import { describe, it, expect } from 'vitest'
import { PALETTE_COMMANDS } from '../CommandPalette'

describe('T11 斜杠命令注册表', () => {
  const slashCommands = PALETTE_COMMANDS.filter((c) => c.slashName)

  it('所有 slash 命令都必须是 action 型（无 insert 型死 token）', () => {
    for (const c of slashCommands) {
      expect(c.kind, `${c.slashName} 必须有执行器`).toBe('action')
      expect(c.actionId, `${c.slashName} 缺少 actionId`).toBeTruthy()
    }
  })

  it('/clear /agent /help /plan 均已注册为真实动作', () => {
    const byName = Object.fromEntries(slashCommands.map((c) => [c.slashName, c]))
    expect(byName['/clear']?.actionId).toBe('clear-conversation')
    expect(byName['/agent']?.actionId).toBe('toggle-agent')
    expect(byName['/help']?.actionId).toBe('open-help')
    expect(byName['/plan']?.actionId).toBe('toggle-plan')
  })

  it('/optimize 已移除（无后端优化能力，不保留死命令）', () => {
    expect(slashCommands.some((c) => c.slashName === '/optimize')).toBe(false)
  })
})
