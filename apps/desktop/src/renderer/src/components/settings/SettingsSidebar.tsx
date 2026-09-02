// ============================================================
// SettingsSidebar — 设置弹框左栏（平铺 11 项 + 3 条水平分隔线）
//   严格匹配 apps/web/docs/help-feedback.html 原型样式：
//   - 230px 宽，#f2f2f2 背景，padding 20px×12px
//   - 33px 高导航项，4px 圆角，灰色 hover 与激活态
//   - dividerAfter=true 的分类之后渲染 1px #e6e6e6 分隔线（左右缩进 12px，上下 8px）
//   不再渲染任何分组小标题（settingsGroups 机制保留为兼容层）。
// ============================================================

import { useAtom } from 'jotai'
import { settingsCategoryAtom } from '@/stores/atoms'
import { settingsCategories, type SettingsCategory } from './settingsConfig'
import { cn } from '@/lib/utils'

function NavItem({
  item,
  isActive,
  onSelect
}: {
  item: SettingsCategory
  isActive: boolean
  onSelect: (id: string) => void
}) {
  const { id, label, icon: Icon } = item
  return (
    <button
      onClick={() => onSelect(id)}
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
}

/** 水平分隔线：左右 12px 缩进，上下 8px 间距 */
function Divider() {
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        background: '#e6e6e6',
        marginTop: 8,
        marginBottom: 8,
        marginLeft: 12,
        marginRight: 12
      }}
    />
  )
}

export function SettingsSidebar() {
  const [active, setActive] = useAtom(settingsCategoryAtom)

  return (
    <nav
      className="settings-sidebar-scroll flex flex-col overflow-y-auto shrink-0"
      style={{ width: 230, background: '#f2f2f2', padding: '20px 12px' }}
    >
      <div className="flex flex-col gap-[4px]">
        {settingsCategories.map((c) => (
          <div key={c.id} className="contents">
            <NavItem item={c} isActive={active === c.id} onSelect={setActive} />
            {c.dividerAfter && <Divider />}
          </div>
        ))}
      </div>
    </nav>
  )
}
