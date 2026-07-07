// ============================================================
// Window Config — 按平台返回 BrowserWindow 构造参数
// 把 main/index.ts 中散落的 frame / titleBarStyle 平台分支收敛为
// 单一配置表，新增平台时只改这里。
// ============================================================

import type { BrowserWindowConstructorOptions } from 'electron'
import { normalizePlatform } from '../shared/types'

export function getWindowOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  const normalized = normalizePlatform(platform)

  switch (normalized) {
    case 'mac':
      // 保留原生 frame，标题栏用 hiddenInset：
      // macOS 自动在红绿灯左侧加 inset 内边距，渲染端不再需要 w-[70px] 魔法数。
      return {
        frame: true,
        titleBarStyle: 'hiddenInset'
      }
    case 'windows':
    case 'linux':
    default:
      // 完全无边框，窗口控件 (min/max/close) 由渲染端 WindowControls 提供。
      return {
        frame: false,
        titleBarStyle: undefined
      }
  }
}
