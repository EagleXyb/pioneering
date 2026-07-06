// ============================================================
// SettingsSidebar — 设置弹框左栏分类导航
//   点击分类写入 settingsCategoryAtom，由 SettingsDialog 渲染对应区块。
// ============================================================

import { useAtom } from 'jotai'
import { settingsCategoryAtom } from '@/stores/atoms'
import { settingsCategories } from './settingsConfig'
import { cn } from '@/lib/utils'

export function SettingsSidebar() {
  const [active, setActive] = useAtom(settingsCategoryAtom)

  return (
    <nav className="h-full border-r border-border bg-muted/30 p-2 space-y-1">
      {settingsCategories.map(({ id, label, icon: Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={cn(
              'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </button>
        )
      })}
    </nav>
  )
}
