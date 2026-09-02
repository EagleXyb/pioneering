// ============================================================
// PersonalizeSection — 通用组 · 个性化
//   由原 AppearanceSection（外观）迁移而来：
//   - 主题三态切换（浅色/深色/跟随系统）逻辑与样式完全保留
//   - SettingsDialog 标题栏已显示「个性化」，组件内不再重复 h2 标题
//   - 预留语言/字号等后续个性化项位（当前仅主题一个卡片）
// ============================================================

import { Sun, Moon, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'

export function PersonalizeSection() {
  const { theme, setTheme } = useAppStore()

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: '浅色', icon: <Sun className="size-4" /> },
    { value: 'dark', label: '深色', icon: <Moon className="size-4" /> },
    { value: 'system', label: '跟随系统', icon: <Monitor className="size-4" /> }
  ]

  return (
    <div className="space-y-4">
      {/* 主题卡片 */}
      <div
        className="flex items-center justify-between px-4 py-[13px] rounded-[5px]"
        style={{ background: '#f7f7f7' }}
      >
        <span className="text-sm text-[#262626]">主题</span>
        <div className="flex gap-2">
          {themeOptions.map(({ value, label, icon }) => (
            <Button
              key={value}
              variant={theme === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTheme(value)}
              className={cn(theme === value ? '' : '')}
            >
              <span className="mr-1.5">{icon}</span>
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* 预留：语言 / 字号等个性化项后续在此追加卡片 */}
    </div>
  )
}
