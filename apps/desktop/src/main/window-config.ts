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
      // y=15 为圆形灯(12px)顶边，中心 y=21。该值经截图像素标定：与渲染层
      // 折叠态浮动按钮（top-2 + h-8）、展开态标题栏按钮的图标视觉质心齐平。
      // 注：trafficLightPosition 仅接受整数，15 是最接近实测值（14.73）的取值。
      return {
        frame: true,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 20, y: 17 }
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
