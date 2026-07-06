// ============================================================
// SettingsDialog — 设置弹框外壳
//   挂载于 RootLayout 顶层，与路由解耦。
//   两栏布局：左栏 SettingsSidebar（分类导航） + 右栏内容区。
//   开关由 settingsOpenAtom 控制，当前分类由 settingsCategoryAtom 控制。
// ============================================================

import { useAtom } from 'jotai'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { getCategory } from './settingsConfig'
import { SettingsSidebar } from './SettingsSidebar'

export function SettingsDialog() {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  const [categoryId] = useAtom(settingsCategoryAtom)

  const { label, Component } = getCategory(categoryId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl w-[720px] h-[560px] max-h-[85vh] grid grid-cols-[200px_1fr] gap-0 p-0 overflow-hidden">
        {/* 左栏：分类导航 */}
        <SettingsSidebar />

        {/* 右栏：内容区 */}
        <div className="flex flex-col h-full min-w-0">
          <div className="flex items-center h-14 px-6 border-b border-border shrink-0">
            <DialogTitle className="text-base font-semibold">{label}</DialogTitle>
            <DialogDescription className="sr-only">{label}相关设置</DialogDescription>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-6">
              <Component />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
