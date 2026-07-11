// ============================================================
// use-input-draft-persistence — 草稿持久化 Hook（对应文档 §11.5）
// 负责：挂载时恢复草稿；内容变化时去抖保存；空草稿自动清理；
// 流式输出 / 禁用 / 未聚焦时跳过保存。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type InputDraftValue,
  isDraftEmpty,
  loadInputDraft,
  removeInputDraft,
  saveInputDraft
} from '@/lib/input/input-drafts'

interface UseInputDraftPersistenceOptions {
  /** 草稿键（通常来自 getSessionInputDraftKey 等） */
  draftKey: string
  /** 读取当前待持久化内容 */
  getValue: () => InputDraftValue
  /** 恢复草稿时回调 */
  onRestore: (draft: InputDraftValue) => void
  /** 是否启用持久化 */
  enabled?: boolean
  /** 流式输出中跳过保存 */
  skipWhenStreaming?: boolean
  /** 禁用态跳过保存 */
  skipWhenDisabled?: boolean
  /** 焦点不在输入区时跳过保存 */
  isFocused?: () => boolean
  /** 去抖延迟，默认 400ms */
  delay?: number
}

export function useInputDraftPersistence({
  draftKey,
  getValue,
  onRestore,
  enabled = true,
  skipWhenStreaming = true,
  skipWhenDisabled = true,
  isFocused,
  delay = 400
}: UseInputDraftPersistenceOptions) {
  const [hydrated, setHydrated] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hydratedRef = useRef(false)
  const skipStreamingRef = useRef(skipWhenStreaming)
  const skipDisabledRef = useRef(skipWhenDisabled)
  const focusedRef = useRef(isFocused)
  const enabledRef = useRef(enabled)
  const getValueRef = useRef(getValue)
  const onRestoreRef = useRef(onRestore)

  skipStreamingRef.current = skipWhenStreaming
  skipDisabledRef.current = skipWhenDisabled
  focusedRef.current = isFocused
  enabledRef.current = enabled
  getValueRef.current = getValue
  onRestoreRef.current = onRestore

  // 挂载：恢复草稿（仅一次）
  useEffect(() => {
    let cancelled = false
    if (!enabledRef.current) {
      setHydrated(true)
      hydratedRef.current = true
      return
    }
    void (async () => {
      const draft = await loadInputDraft(draftKey)
      if (cancelled) return
      if (draft && !isDraftEmpty(draft)) {
        onRestoreRef.current(draft)
      }
      hydratedRef.current = true
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, enabled])

  // 内容变化：去抖保存
  const scheduleSave = useCallback(() => {
    if (!enabledRef.current || !hydratedRef.current) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const value = getValueRef.current()
      if (isDraftEmpty(value)) {
        void removeInputDraft(draftKey)
        return
      }
      // B10 修复：原实现 `if (focusedRef.current && !focusedRef.current()) return`
      // 在 blur 后（isFocused 返回 false）跳过保存，导致用户切走时草稿丢失。
      // 草稿持久化的目的就是"即使用户离开也能恢复"，blur 时仍应保存。
      void saveInputDraft(draftKey, value)
    }, delay)
  }, [draftKey, delay])

  // 卸载 / 键变化：冲刷去抖窗口内尚未保存的草稿 + 清理
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        // E4: 卸载（或切换 draftKey）时若去抖窗口内还有未保存的草稿，立即冲刷一次，
        // 否则这段时间内的输入会静默丢失。仅在聚焦态才保存（与 scheduleSave 一致）。
        const value = getValueRef.current()
        if (!isDraftEmpty(value) && (!focusedRef.current || focusedRef.current())) {
          void saveInputDraft(draftKey, value)
        }
      }
    }
  }, [draftKey])

  /** 立即清除当前草稿（发送成功后调用）。 */
  const clearDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    hydratedRef.current = false
    setHydrated(false)
    void removeInputDraft(draftKey)
  }, [draftKey])

  return { hydrated, scheduleSave, clearDraft }
}
