// ============================================================
// useArtifactPreview — 「产物卡片 → 预览面板」统一入口（React 绑定层）
// ============================================================
// 背景：产物列表（TaskMonitor）此前只能「在 Finder 中显示」，无法在应用内查看文件内容。
// 本 hook 把「判定类型 → 读取本地文件 → 打开预览面板 → 错误兜底」收敛为单一入口，
// 供产物卡片等调用方复用，避免各处重复实现异常处理。
//
// 数据来源：attachment.filePath（桌面端 Agent 产物）。
//   - 读取走既有 FILE_READ 通道，产物落 userData/Documents 已在主进程白名单内，
//     因此不需要新增任何 IPC 通道，也不触碰 CSP 与安全边界。
//   - 单文件上限沿用主进程 MAX_FILE_BYTES（10MB），超限时透传并转为中文提示。
//   - FILE_READ 是 utf-8 文本通道：二进制文件读取会损坏，故对图片等类型明确拒绝，
//     而不是静默渲染乱码。
//
// 类型判定等纯逻辑见 lib/artifact-preview.ts（可独立单测）。
// ============================================================

import { useCallback, useState } from 'react'
import { useSetAtom } from 'jotai'
import { openArtifactAtom } from '@/stores/artifactStore'
import { fileApi } from '@/services/ipc'
import { detectArtifactPreview, toHumanError } from '@/lib/artifact-preview'
import type { Attachment } from '@shared/types'

export interface UseArtifactPreviewResult {
  /** 打开指定附件的预览；成功返回 true */
  preview: (attachment: Attachment) => Promise<boolean>
  /** 正在读取的文件路径（驱动卡片 loading 态）；空闲为 null */
  loadingPath: string | null
  /** 最近一次失败原因；每次 preview 调用时重置 */
  error: string | null
  /** 手动清除错误提示 */
  clearError: () => void
}

export function useArtifactPreview(): UseArtifactPreviewResult {
  const openArtifact = useSetAtom(openArtifactAtom)
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const preview = useCallback(
    async (attachment: Attachment): Promise<boolean> => {
      setError(null)

      const target = detectArtifactPreview(attachment.name, attachment.mediaType)
      if (!target) {
        setError(`「${attachment.name}」暂不支持应用内预览，请在文件夹中查看`)
        return false
      }
      if (!attachment.filePath) {
        setError(`「${attachment.name}」缺少本地文件路径，无法读取`)
        return false
      }

      setLoadingPath(attachment.filePath)
      try {
        const result = await fileApi.read(attachment.filePath)
        if (!result.success) {
          setError(toHumanError(result.error, attachment.name))
          return false
        }
        const content = result.content
        if (typeof content !== 'string') {
          setError(`读取「${attachment.name}」失败：内容为空`)
          return false
        }
        openArtifact({
          // 产物来自文件系统，无对应消息：空串使预览工具条隐藏「跳转源消息」
          messageId: '',
          type: target.type,
          content,
          language: target.language,
          // 标签栏以文件名标识标签，便于在多个产物标签间区分
          title: attachment.name
        })
        return true
      } catch {
        setError(`读取「${attachment.name}」失败`)
        return false
      } finally {
        setLoadingPath(null)
      }
    },
    [openArtifact]
  )

  const clearError = useCallback(() => setError(null), [])

  return { preview, loadingPath, error, clearError }
}
