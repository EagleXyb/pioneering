// ============================================================
// MenuDropdown — 由 menuTemplate 数据渲染的单个下拉菜单
// 取代原 TitleBar 内手写的 4 个 DropdownMenu（Pioneering/编辑/窗口/帮助），
// 快捷键经 formatAccelerator 按平台本地化显示。
// ============================================================

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut
} from '@/components/ui/dropdown-menu'
import type { MenuTemplateItem } from '@shared/menu-template'
import { runMenuAction } from './menuActions'
import { formatAccelerator } from './formatAccelerator'
import type { Platform } from '@shared/types'

export function MenuDropdown({ item, platform }: { item: MenuTemplateItem; platform: Platform }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-sm transition-colors outline-none">
          {item.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-48">
        {item.submenu?.map((sub, i) => {
          if (sub.separator) {
            return <DropdownMenuSeparator key={`sep-${i}`} />
          }
          return (
            <DropdownMenuItem
              key={sub.id ?? sub.label}
              onSelect={() => {
                if (sub.id) runMenuAction(sub.id)
              }}
            >
              {sub.label}
              {sub.accelerator && (
                <DropdownMenuShortcut>{formatAccelerator(sub.accelerator, platform)}</DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
