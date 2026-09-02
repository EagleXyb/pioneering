// ============================================================
// settingsConfig — 设置分类配置（单一数据源）
//   驱动 SettingsSidebar 的左栏导航 与 SettingsDialog 的右栏渲染。
//
//   左栏结构（按顺序平铺，分隔线见 dividerAfter 字段）：
//     账号
//     通用
//     快捷键
//     系统设置
//     ──── 分隔线 1 ────
//     智能体
//     记忆
//     模型
//     助理
//     ──── 分隔线 2 ────
//     数据管理
//     安全中心
//     ──── 分隔线 3 ────
//     关于
//   历史：
//     - 原「分组小标题」机制（settingsGroups/getGroup）保留为兼容层；
//       但 SettingsSidebar 已改为平铺 + dividerAfter，不再渲染分组标题。
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
  Database,
  Shield,
  HardDrive
} from 'lucide-react'
import { AboutSection } from './sections/AboutSection'
import { ModelSection } from './sections/ModelSection'
import { GeneralSection } from './sections/GeneralSection'
import { SystemSettingsCompositeSection } from './sections/SystemSettingsCompositeSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { DataManagementSection } from './sections/DataManagementSection'
import { SecuritySection } from './sections/SecuritySection'

export interface SettingsCategory {
  id: string
  label: string
  icon: LucideIcon
  Component: ComponentType
  /** 在该项之后是否渲染一条水平分隔线（分组视觉断点） */
  dividerAfter?: boolean
}

// ────────────────────────────────────────────────────────────
// 兼容层：保留分组查询 API（SettingsDialog 标题、外部代码可能引用）
//   分类不再视觉上归属于「分组小标题」，但 getGroup 仍返回 label 为 '' 的空组。
// ────────────────────────────────────────────────────────────
export interface SettingsGroup {
  id: string
  label: string
}
export const settingsGroups: SettingsGroup[] = []
export function getGroup(_groupId?: string): SettingsGroup | undefined {
  return undefined
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
function placeholder(
  id: string,
  label: string,
  icon: LucideIcon,
  dividerAfter = false
): SettingsCategory {
  return {
    id,
    label,
    icon,
    Component: () => <PlaceholderSection label={label} />,
    dividerAfter
  }
}

// ============================================================
// 11 项 · 按需求给出的顺序精确排列（分隔线见 dividerAfter）
// ============================================================
export const settingsCategories: SettingsCategory[] = [
  // 段 1：账号 / 通用 / 快捷键 / 系统设置
  placeholder('account', '账号', User),
  {
    id: 'general',
    label: '通用',
    icon: Monitor,
    Component: GeneralSection
  },
  {
    id: 'shortcut',
    label: '快捷键',
    icon: Keyboard,
    Component: ShortcutsSection
  },
  {
    id: 'system',
    label: '系统设置',
    icon: Settings,
    Component: SystemSettingsCompositeSection,
    dividerAfter: true // ──── 分隔线 1 ────
  },

  // 段 2：智能体 / 记忆 / 模型 / 助理
  placeholder('agent', '智能体', Bot),
  placeholder('memory', '记忆', BrainCircuit),
  { id: 'model', label: '模型', icon: Cpu, Component: ModelSection },
  placeholder('assistant', '助理', User, true // ──── 分隔线 2 ────
  ),

  // 段 3：数据管理 / 安全中心
  { id: 'data', label: '数据管理', icon: Database, Component: DataManagementSection },
  { id: 'security', label: '安全中心', icon: Shield, Component: SecuritySection, dividerAfter: true // ──── 分隔线 3 ────
  },

  // 段 4：关于
  { id: 'about', label: '关于', icon: Info, Component: AboutSection }
]

// ============================================================
// 旧 id → 新 id 重定向（合并/改名后的兼容层）
// ============================================================
const CATEGORY_REDIRECTS: Record<string, string> = {
  help: 'about', // 帮助与反馈 → 关于（合并）

  // 原「外观 / 个性化」独立入口 → 通用（基础设置·个性化·主题已在通用内）
  appearance: 'general',
  personalize: 'general',

  // 原「外网 API / 本地运行时 / 认证」独立分类 → 系统设置复合页
  api: 'system',
  'local-runtime': 'system',
  auth: 'system'
}

/** 按 id 查找分类，找不到回退第一项；旧 id 经重定向表映射 */
export function getCategory(id: string): SettingsCategory {
  const mapped = CATEGORY_REDIRECTS[id] ?? id
  return settingsCategories.find((c) => c.id === mapped) ?? settingsCategories[0]!
}
