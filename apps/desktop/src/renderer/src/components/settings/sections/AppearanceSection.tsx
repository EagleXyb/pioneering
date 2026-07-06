// ---- AppearanceSection ----
// 原 SettingsPage 中「外观」卡片内容，独立为设置弹框的一个分类区块。

import { Monitor, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, type ThemeMode } from '@/stores/useAppStore'

export function AppearanceSection() {
  const { theme, setTheme } = useAppStore()

  const themeOptions: { value: ThemeMode; label: string; icon: React.ReactNode }[] = [
    { value: 'light', label: '浅色', icon: <Sun className="size-4" /> },
    { value: 'dark', label: '深色', icon: <Moon className="size-4" /> },
    { value: 'system', label: '跟随系统', icon: <Monitor className="size-4" /> }
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Monitor className="size-5 text-primary" />
        <h2 className="text-lg font-semibold">外观</h2>
      </div>
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
  )
}
