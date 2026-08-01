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
      // macOS 自动在红绿灯左侧加 inset 内边距，通过 trafficLightPosition 精确定位。
      // 红绿灯位置: x=9(距左边缘), y=18(垂直居中于 48px 标题栏，中心 y=24px)。
      return {
        frame: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 21, y: 21 }
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
