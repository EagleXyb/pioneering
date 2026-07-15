// ============================================================
// SettingsSidebar — 设置弹框左栏分类导航
//   严格匹配 apps/web/docs/help-feedback.html 原型样式：
//   - 230px 宽，#f2f2f2 背景
//   - 40px 高导航项，4px 圆角，灰色 hover 与激活态
// ============================================================

import { useAtom } from 'jotai'
import { settingsCategoryAtom } from '@/stores/atoms'
import { settingsCategories } from './settingsConfig'
import { cn } from '@/lib/utils'

export function SettingsSidebar() {
  const [active, setActive] = useAtom(settingsCategoryAtom)

  return (
    <nav
      className="flex flex-col overflow-y-auto shrink-0"
      style={{ width: 230, background: '#f2f2f2', padding: '20px 12px' }}
    >
      <div className="space-y-[4px]">
        {settingsCategories.map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={cn(
                'w-full flex items-center gap-3 rounded-[4px] px-3 text-sm text-left transition-colors duration-150',
                'h-[33px]',
                isActive
                  ? 'bg-[#e0e0e0] font-semibold text-[#262626]'
                  : 'text-[#262626] hover:bg-[#e8e8e8]'
              )}
            >
              <Icon
                className="shrink-0"
                style={{ width: 18, height: 18, color: isActive ? '#595959' : '#8c8c8c' }}
              />
              <span className="truncate">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
