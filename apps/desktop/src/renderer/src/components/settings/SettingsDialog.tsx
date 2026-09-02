// ============================================================
// SettingsDialog — 设置弹框外壳
//   匹配 apps/web/docs/help-feedback.html 原型：
//   900×600 浮动窗口，两栏布局，中性灰色调。
// ============================================================

import { useAtom } from 'jotai'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { settingsOpenAtom, settingsCategoryAtom } from '@/stores/atoms'
import { getCategory } from './settingsConfig'
import { SettingsSidebar } from './SettingsSidebar'
import { useAppStore, FONT_SIZE_PX, type FontSizeMode } from '@/stores/useAppStore'
import { pxToRem } from '@/lib/utils'
import './settings-dialog.css'

export function SettingsDialog() {
  const [open, setOpen] = useAtom(settingsOpenAtom)
  const [categoryId] = useAtom(settingsCategoryAtom)

  // ========================================================
  // 字体大小档位 → 作用到弹壳自身：
  //   Radix DialogPortal 将内容挂到 body 下的独立节点，
  //   html { font-size: var(--app-font-size) } 无法穿透到弹内，
  //   所以必须在弹壳根元素（DialogContent）上显式同步档位，
  //   弹内以 rem 声明的文本字号才能正确按档位缩放。
  // ========================================================
  const fontSize: FontSizeMode = useAppStore((s) => s.fontSize)
  const shellRemPx = FONT_SIZE_PX[fontSize]

  const category = getCategory(categoryId)
  // 平铺时代：每个分类右栏大标题直接用分类自己的 label
  // （账号 / 通用 / 快捷键 / 系统设置 / 智能体 / ... / 模型 / ... / 关于）
  const label = category.label
  const Component = category.Component

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="settings-dialog-root flex !max-w-none !p-0 !gap-0 overflow-hidden"
        data-font-size={fontSize}
        style={{
          width: 1000,
          height: 680,
          borderRadius: 12,
          boxShadow: '0 16px 56px rgba(0,0,0,0.14)',
          // 让弹壳下的 1rem = 档位基准（small=13 / medium=14 / large=16），
          // 配合内部用 rem 声明的字号，档位切换时整个弹框按比例缩放。
          fontSize: `${shellRemPx}px`,
          ['--shell-rem' as any]: `${shellRemPx}px`
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
            <X style={{ width: pxToRem(18), height: pxToRem(18) }} strokeWidth={1.5} />
          </button>

          {/* 标题栏 */}
          <div className="shrink-0 px-10 pt-8 pb-4">
            <DialogTitle
              className="m-0 font-semibold leading-none tracking-[0.01em]"
              style={{ color: '#1a1a1a', fontSize: pxToRem(22) }}
            >
              {label}
            </DialogTitle>
            <DialogDescription className="sr-only">{label}相关设置</DialogDescription>
          </div>

          {/* 内容区
              注意：这里刻意不用 Radix ScrollArea —— 它会把子内容包进
              <div style="display:table; min-width:100%">，table 布局下 truncate（nowrap）
              文本的 min-content 会把宽度撑爆，导致行内控件溢出右边界。
              原生 overflow-y-auto 的块级容器没有该问题，宽度始终收敛为 100%。 */}
          <div className="settings-scroll-area flex-1 min-h-0 overflow-y-auto">
            <div className="px-10 pb-10">
              <Component />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
