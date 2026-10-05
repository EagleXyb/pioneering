import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  parseAccelerator,
  matchesAccelerator,
  eventToAccelerator,
  formatBindingForDisplay
} from '@renderer/lib/match-accelerator'
import { resolveBinding, findConflicts, isDangerousBinding, HOTKEY_DEFINITIONS } from '@shared/hotkey-registry'

// T16 修复（修复任务清单 T16 / 报告 §2.7-测试债）：
// 这些用例断言的是 Windows/Linux 语义（Ctrl 命中 CmdOrCtrl、显示 'Ctrl+Comma'）。
// 引擎经 navigator.platform/userAgent 读真实平台，直接在开发机（macOS）跑会漂移。
// 这里统一注入 Windows 平台，使测试跨平台稳定；macOS 分支另有独立 describe 覆盖。
function stubPlatform(platform: string, userAgent = '') {
  vi.stubGlobal('navigator', { platform, userAgent })
}
afterEach(() => {
  vi.unstubAllGlobals()
})

// 构造 KeyboardEvent 的最小模拟（匹配引擎只读 code/key/四个修饰键）
function ke(partial: {
  key?: string
  code?: string
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): KeyboardEvent {
  return {
    key: partial.key ?? '',
    code: partial.code ?? '',
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
    metaKey: partial.metaKey ?? false,
    preventDefault: () => {},
    stopPropagation: () => {}
  } as unknown as KeyboardEvent
}

describe('parseAccelerator', () => {
  it('解析单键 Enter', () => {
    const p = parseAccelerator('Enter')
    expect(p).not.toBeNull()
    expect(p!.key).toBe('enter')
    expect(p!.ctrl).toBe(false)
  })

  it('解析 CmdOrCtrl+Comma', () => {
    const p = parseAccelerator('CmdOrCtrl+Comma')
    expect(p!.cmdOrCtrl).toBe(true)
    expect(p!.key).toBe(',')
  })

  it('解析 Shift+Enter', () => {
    const p = parseAccelerator('Shift+Enter')
    expect(p!.shift).toBe(true)
    expect(p!.key).toBe('enter')
  })

  it('解析 Shift+Alt+W', () => {
    const p = parseAccelerator('Shift+Alt+W')
    expect(p!.shift).toBe(true)
    expect(p!.alt).toBe(true)
    expect(p!.key).toBe('w')
  })

  it('Plus 归一化为 =', () => {
    const p = parseAccelerator('Ctrl+Plus')
    expect(p!.key).toBe('=')
  })

  it('未知修饰键返回 null', () => {
    expect(parseAccelerator('Foo+Enter')).toBeNull()
  })
})

describe('matchesAccelerator', () => {
  // T16：本组按 Windows/Linux 语义断言（CmdOrCtrl ↔ Ctrl）
  beforeEach(() => stubPlatform('Win32'))

  it('Enter（无修饰键）命中 send-message 默认绑定', () => {
    expect(matchesAccelerator(ke({ key: 'Enter', code: 'Enter' }), 'Enter')).toBe(true)
  })

  it('Shift+Enter 不命中 Enter（修饰键精确匹配）', () => {
    expect(
      matchesAccelerator(
        ke({ key: 'Enter', code: 'Enter', shiftKey: true }),
        'Enter'
      )
    ).toBe(false)
  })

  it('Shift+Enter 命中 Shift+Enter', () => {
    expect(
      matchesAccelerator(ke({ key: 'Enter', code: 'Enter', shiftKey: true }), 'Shift+Enter')
    ).toBe(true)
  })

  it('Ctrl+B 命中 CmdOrCtrl+B（Windows：Ctrl）', () => {
    expect(
      matchesAccelerator(ke({ key: 'b', code: 'KeyB', ctrlKey: true }), 'CmdOrCtrl+B')
    ).toBe(true)
  })

  it('Ctrl+Shift+B 不命中 CmdOrCtrl+B（多余 Shift）', () => {
    expect(
      matchesAccelerator(
        ke({ key: 'b', code: 'KeyB', ctrlKey: true, shiftKey: true }),
        'CmdOrCtrl+B'
      )
    ).toBe(false)
  })

  it('Ctrl+, 命中 CmdOrCtrl+Comma（物理键位匹配）', () => {
    expect(
      matchesAccelerator(ke({ key: ',', code: 'Comma', ctrlKey: true }), 'CmdOrCtrl+Comma')
    ).toBe(true)
  })

  it('F11 命中 F11', () => {
    expect(matchesAccelerator(ke({ key: 'F11', code: 'F11' }), 'F11')).toBe(true)
  })

  it('Ctrl+= 命中 Ctrl+Plus', () => {
    expect(matchesAccelerator(ke({ key: '=', code: 'Equal', ctrlKey: true }), 'Ctrl+Plus')).toBe(true)
  })

  it('Ctrl+- 命中 Ctrl+-', () => {
    expect(matchesAccelerator(ke({ key: '-', code: 'Minus', ctrlKey: true }), 'Ctrl+-')).toBe(true)
  })

  it('Shift+Alt+W 命中（Windows）', () => {
    expect(
      matchesAccelerator(ke({ key: 'w', code: 'KeyW', shiftKey: true, altKey: true }), 'Shift+Alt+W')
    ).toBe(true)
  })

  it('Alt+W 不命中 Shift+Alt+W（缺 Shift）', () => {
    expect(
      matchesAccelerator(ke({ key: 'w', code: 'KeyW', altKey: true }), 'Shift+Alt+W')
    ).toBe(false)
  })

  it('null 绑定永不命中', () => {
    expect(matchesAccelerator(ke({ key: 'Enter', code: 'Enter' }), null)).toBe(false)
  })

  it('e.key 布局差异时 e.code 兜底（AZERTY：物理 KeyW 产出 key=z）', () => {
    expect(
      matchesAccelerator(ke({ key: 'z', code: 'KeyW', shiftKey: true, altKey: true }), 'Shift+Alt+W')
    ).toBe(true)
  })
})

describe('eventToAccelerator', () => {
  // T16：录制存储统一为 CmdOrCtrl，本组断言 Windows 下 Ctrl → CmdOrCtrl
  beforeEach(() => stubPlatform('Win32'))

  it('Ctrl+D → CmdOrCtrl+D（Windows 语义统一存储）', () => {
    expect(eventToAccelerator(ke({ key: 'd', code: 'KeyD', ctrlKey: true }))).toBe('CmdOrCtrl+D')
  })

  it('Shift+Enter → Shift+Enter', () => {
    expect(
      eventToAccelerator(ke({ key: 'Enter', code: 'Enter', shiftKey: true }))
    ).toBe('Shift+Enter')
  })

  it('纯修饰键返回 null', () => {
    expect(eventToAccelerator(ke({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull()
  })

  it('F11 → F11', () => {
    expect(eventToAccelerator(ke({ key: 'F11', code: 'F11' }))).toBe('F11')
  })

  it('录制结果可被 matchesAccelerator 命中（往返一致性）', () => {
    const accel = eventToAccelerator(ke({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }))
    expect(accel).toBe('CmdOrCtrl+Shift+K')
    expect(
      matchesAccelerator(ke({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true }), accel)
    ).toBe(true)
  })
})

describe('formatBindingForDisplay（Windows 展示）', () => {
  // T16：本组断言 Windows 符号（Ctrl / + 连接）
  beforeEach(() => stubPlatform('Win32'))

  it('null → 未绑定', () => {
    expect(formatBindingForDisplay(null)).toBe('未绑定')
  })

  it('Ctrl+Comma → Ctrl+Comma 展示', () => {
    expect(formatBindingForDisplay('Ctrl+Comma')).toBe('Ctrl+Comma')
  })

  it('CmdOrCtrl+Shift+K → Ctrl+Shift+K 展示', () => {
    expect(formatBindingForDisplay('CmdOrCtrl+Shift+K')).toBe('Ctrl+Shift+K')
  })
})

// T16：macOS 平台语义独立成组（注入 MacIntel），防止平台分支无测试覆盖
describe('平台分支：macOS', () => {
  beforeEach(() => stubPlatform('MacIntel'))

  it('Cmd(meta)+B 命中 CmdOrCtrl+B，Ctrl 不命中', () => {
    expect(
      matchesAccelerator(ke({ key: 'b', code: 'KeyB', metaKey: true }), 'CmdOrCtrl+B')
    ).toBe(true)
    expect(
      matchesAccelerator(ke({ key: 'b', code: 'KeyB', ctrlKey: true }), 'CmdOrCtrl+B')
    ).toBe(false)
  })

  it('录制：Cmd(meta)+K → CmdOrCtrl+K', () => {
    expect(eventToAccelerator(ke({ key: 'k', code: 'KeyK', metaKey: true }))).toBe('CmdOrCtrl+K')
  })

  it('展示：CmdOrCtrl+Comma → ⌘Comma（mac 符号，无连接符）', () => {
    expect(formatBindingForDisplay('CmdOrCtrl+Comma')).toBe('⌘Comma')
  })

  it('展示：Ctrl+Comma → ⌃Comma（mac 下 Ctrl 显示为 ⌃）', () => {
    expect(formatBindingForDisplay('Ctrl+Comma')).toBe('⌃Comma')
  })
})

describe('hotkey-registry', () => {
  it('默认覆盖表为空时 resolveBinding 返回默认绑定', () => {
    expect(resolveBinding('open-settings', {})).toBe('Ctrl+Comma')
    expect(resolveBinding('send-message', {})).toBe('Enter')
  })

  it('null 覆盖 = 显式禁用', () => {
    expect(resolveBinding('toggle-record', { 'toggle-record': null })).toBeNull()
  })

  it('覆盖优先于默认', () => {
    expect(resolveBinding('open-settings', { 'open-settings': 'Ctrl+P' })).toBe('Ctrl+P')
  })

  it('findConflicts 检出同绑定命令', () => {
    const hits = findConflicts('new-chat', 'Ctrl+B', {})
    // 默认表中 toggle-right-panel 占用 Ctrl+B
    expect(hits).toContain('toggle-right-panel')
    expect(hits).not.toContain('new-chat')
  })

  it('findConflicts 对禁用绑定返回空', () => {
    expect(findConflicts('new-chat', null, {})).toEqual([])
  })

  it('isDangerousBinding 识别 Ctrl+W / F5，放过 Ctrl+P', () => {
    expect(isDangerousBinding('Ctrl+W')).toBe(true)
    expect(isDangerousBinding('F5')).toBe(true)
    expect(isDangerousBinding('Ctrl+P')).toBe(false)
  })

  it('send-message / newline-on-input 标记 handledInComponent（引擎防双触发）', () => {
    for (const id of ['send-message', 'newline-on-input'] as const) {
      const def = HOTKEY_DEFINITIONS.find((d) => d.id === id)
      expect(def?.handledInComponent).toBe(true)
    }
  })

  it('toggle-main-window 为 scope=global（主进程处理）', () => {
    const def = HOTKEY_DEFINITIONS.find((d) => d.id === 'toggle-main-window')
    expect(def?.scope).toBe('global')
  })
})
