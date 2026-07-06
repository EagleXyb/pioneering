// ============================================================
// settingsConfig — 设置分类配置（单一数据源）
//   驱动 SettingsSidebar 的左栏导航 与 SettingsDialog 的右栏渲染。
//   新增分类只需在此数组追加一项，无需改动弹框外壳。
// ============================================================

import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Globe, Key, Monitor, Info } from 'lucide-react'
import { ApiConnectionSection } from './sections/ApiConnectionSection'
import { AuthSection } from './sections/AuthSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AboutSection } from './sections/AboutSection'

export interface SettingsCategory {
  /** 分类唯一标识，对应 settingsCategoryAtom 的值 */
  id: string
  /** 左栏导航展示文案 */
  label: string
  /** 左栏导航图标 */
  icon: LucideIcon
  /** 右栏内容区对应的区块组件 */
  Component: ComponentType
}

export const settingsCategories: SettingsCategory[] = [
  { id: 'api', label: 'API 连接', icon: Globe, Component: ApiConnectionSection },
  { id: 'auth', label: '认证', icon: Key, Component: AuthSection },
  { id: 'appearance', label: '外观', icon: Monitor, Component: AppearanceSection },
  { id: 'about', label: '关于', icon: Info, Component: AboutSection }
]

/** 按 id 查找分类，找不到时回退到第一个（默认分类） */
export function getCategory(id: string): SettingsCategory {
  return settingsCategories.find((c) => c.id === id) ?? settingsCategories[0]!
}
