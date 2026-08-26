// ============================================================
// settingsConfig — 设置分类配置（单一数据源）
//   驱动 SettingsSidebar 的左栏导航 与 SettingsDialog 的右栏渲染。
//   分类顺序按 apps/web/docs/help-feedback.html 原型排列。
// ============================================================

import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Globe,
  Key,
  Monitor,
  Info,
  User,
  Settings,
  Bot,
  Keyboard,
  BrainCircuit,
  Cpu,
  Sparkles,
  Database,
  Shield,
  HelpCircle,
  HardDrive
} from 'lucide-react'
import { ApiConnectionSection } from './sections/ApiConnectionSection'
import { AuthSection } from './sections/AuthSection'
import { AppearanceSection } from './sections/AppearanceSection'
import { AboutSection } from './sections/AboutSection'
import { HelpSection } from './sections/HelpSection'
import { ModelSection } from './sections/ModelSection'
import { LocalRuntimeSection } from './sections/LocalRuntimeSection'

export interface SettingsCategory {
  id: string
  label: string
  icon: LucideIcon
  Component: ComponentType
}

/** 占位组件 — 提示该分类尚未实现 */
function PlaceholderSection({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-16">
      <p className="text-sm text-muted-foreground">{label} — 功能正在建设中</p>
    </div>
  )
}

/** 生成占位分类 */
function placeholder(id: string, label: string, icon: LucideIcon): SettingsCategory {
  return {
    id,
    label,
    icon,
    Component: () => <PlaceholderSection label={label} />
  }
}

export const settingsCategories: SettingsCategory[] = [
  // 原型 11 项
  placeholder('account', '账户管理', User),
  placeholder('system', '系统设置', Settings),
  placeholder('agent', '智能体配置', Bot),
  placeholder('shortcut', '快捷键', Keyboard),
  placeholder('memory', '记忆', BrainCircuit),
  { id: 'model', label: '模型', icon: Cpu, Component: ModelSection },
  placeholder('assistant', '助理设置', User),
  placeholder('personalize', '个性化', Sparkles),
  placeholder('data', '数据管理', Database),
  placeholder('security', '安全中心', Shield),

  // 帮助与反馈（完整实现）
  { id: 'help', label: '帮助与反馈', icon: HelpCircle, Component: HelpSection },

  // 已有功能分类
  { id: 'api', label: 'API 连接', icon: Globe, Component: ApiConnectionSection },
  {
    id: 'local-runtime',
    label: '本地运行时',
    icon: HardDrive,
    Component: LocalRuntimeSection
  },
  { id: 'auth', label: '认证', icon: Key, Component: AuthSection },
  { id: 'appearance', label: '外观', icon: Monitor, Component: AppearanceSection },
  { id: 'about', label: '关于', icon: Info, Component: AboutSection }
]

/** 按 id 查找分类，找不到时回退到第一个 */
export function getCategory(id: string): SettingsCategory {
  return settingsCategories.find((c) => c.id === id) ?? settingsCategories[0]!
}
