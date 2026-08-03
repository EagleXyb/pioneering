// ============================================================
// ConfirmDialog — 通用自定义确认弹窗（Radix Dialog，替换系统 window.confirm）
// ============================================================
// 样式对齐截图：
//   - 卡片 12px 圆角 + 白色背景
//   - 标题左对齐：⚠ 警告图标（橙黄色） + 黑色粗体标题
//   - 描述：灰色普通字
//   - 底栏右对齐：「取消」浅灰按钮 + 「确认删除」红色实色按钮
//
// 用法：
//   import { useSetAtom } from 'jotai'
//   import { openConfirmDialogAtom } from '@/stores/atoms'
//   const openConfirm = useSetAtom(openConfirmDialogAtom)
//   openConfirm({ id: 'delete-1', title:'删除任务', description:'...', confirmText:'确认删除',
//                 confirmVariant:'destructive', icon:'warning', onConfirm: async () => ... })
//   // 关闭：openConfirm(null)
// ============================================================

import { useCallback, useMemo, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { AlertTriangle, Info, AlertCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from './dialog'
import { Button } from './button'
import { confirmDialogStateAtom, openConfirmDialogAtom } from '@/stores/atoms'

const iconMap = {
  warning: AlertTriangle,
  info: Info,
  danger: AlertCircle
} as const

const iconColorMap: Record<string, string> = {
  warning: 'text-amber-500',
  info: 'text-blue-500',
  danger: 'text-destructive'
}

export function ConfirmDialog() {
  const [payload] = useAtom(confirmDialogStateAtom)
  const closeDialog = useSetAtom(openConfirmDialogAtom)
  const [confirming, setConfirming] = useState(false)
  const open = payload !== null

  const Icon = useMemo(() => {
    if (!payload?.icon) return AlertTriangle
    return iconMap[payload.icon] ?? AlertTriangle
  }, [payload?.icon])

  const iconClass = useMemo(
    () => (payload ? iconColorMap[payload.icon ?? 'warning'] : ''),
    [payload]
  )

  const close = useCallback(() => {
    if (!confirming) closeDialog(null)
  }, [confirming, closeDialog])

  const handleConfirm = useCallback(async () => {
    if (!payload || confirming) return
    try {
      setConfirming(true)
      await payload.onConfirm()
    } finally {
      setConfirming(false)
      closeDialog(null)
    }
  }, [payload, confirming, closeDialog])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        hideClose
        // 覆盖默认类：移除 header close button、改用 12px 圆角 + 更大内边距 + max-w 收窄
        className="w-[460px] max-w-[90vw] !rounded-[12px] !p-6 !gap-0 shadow-xl border"
      >
        {payload && (
          <>
            <DialogHeader className="!space-y-0 !text-left">
              <div className="flex items-center gap-2 mb-3">
                <Icon className={`h-5 w-5 shrink-0 ${iconClass}`} />
                <h2 className="text-base font-semibold leading-none text-foreground">
                  {payload.title}
                </h2>
              </div>
            </DialogHeader>
            <div className="mb-6">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {payload.description}
              </p>
            </div>
            <DialogFooter className="!flex-row !justify-end !gap-2 sm:space-x-0">
              <Button
                variant="outline"
                size="sm"
                onClick={close}
                disabled={confirming}
                className="h-8 px-4"
              >
                {payload.cancelText ?? '取消'}
              </Button>
              <Button
                variant={payload.confirmVariant === 'default' ? 'default' : 'destructive'}
                size="sm"
                onClick={handleConfirm}
                disabled={confirming}
                className="h-8 px-4"
              >
                {payload.confirmText}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
