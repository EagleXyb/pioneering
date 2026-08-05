// ============================================================
// SettingsDialog — 设置弹框外壳
//   匹配 apps/web/docs/help-feedback.html 原型：
//   900×600 浮动窗口，两栏布局，中性灰色调。
// ============================================================

import { useAtom } from 'jotai'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { X } from 'lucide-react'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { getCategory } from './settingsConfig'
import { SettingsSidebar } from './SettingsSidebar'

export function SettingsDialog() {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  const [categoryId] = useAtom(settingsCategoryAtom)

  const { label, Component } = getCategory(categoryId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="flex !max-w-none !p-0 !gap-0 overflow-hidden"
        style={{
          width: 1000,
          height: 680,
          borderRadius: 12,
          boxShadow: '0 16px 56px rgba(0,0,0,0.14)'
        }}
        hideClose
      >
        {/* 左栏：分类导航 */}
        <SettingsSidebar />

        {/* 右栏：内容区 */}
        <div className="flex flex-col flex-1 min-w-0 bg-white relative">
          {/* 右上角关闭按钮：绝对定位贴近角落 */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-4 right-4 flex items-center justify-center h-8 w-8 text-[#8c8c8c] hover:text-[#595959] hover:bg-black/5 transition-colors bg-transparent border-none p-0 cursor-pointer rounded-md z-10"
            aria-label="关闭"
          >
            <X style={{ width: 18, height: 18 }} strokeWidth={1.5} />
          </button>

          {/* 标题栏 */}
          <div className="shrink-0 px-10 pt-8 pb-4">
            <DialogTitle
              className="m-0 text-[22px] font-semibold leading-none tracking-[0.01em]"
              style={{ color: '#1a1a1a' }}
            >
              {label}
            </DialogTitle>
            <DialogDescription className="sr-only">{label}相关设置</DialogDescription>
          </div>

          {/* 内容区 */}
          <ScrollArea className="flex-1">
            <div className="px-10 pb-10">
              <Component />
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
