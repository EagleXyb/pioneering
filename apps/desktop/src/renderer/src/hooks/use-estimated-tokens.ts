// ============================================================
// use-estimated-tokens — Token 估算（对应文档 §13）
// 提供去抖后的粗略 Token 估算，用于输入框状态栏展示。
// 估算规则：CJK 按字计，其他按 ~4 字符/token；每张图片 +~1024。
// ============================================================

import { useEffect, useRef, useState } from 'react'

function estimateSync(text: string, imageCount = 0): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[　-鿿＀-￯]/.test(ch)) cjk += 1
    else other += 1
  }
  const textTokens = Math.ceil(cjk + other / 4)
  const imageTokens = imageCount * 1024
  return textTokens + imageTokens
}

/**
 * 返回去抖后的 Token 估算值。
 * @param text 输入文本
 * @param imageCount 附带图片数量
 * @param delay 去抖延迟，默认 300ms
 */
export function useEstimatedTokens(text: string, imageCount = 0, delay = 300): number {
  const [tokens, setTokens] = useState(() => estimateSync(text, imageCount))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setTokens(estimateSync(text, imageCount))
    }, delay)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [text, imageCount, delay])

  return tokens
}

/** 非 Hook 同步估算（供发送前校验等场景）。 */
export function estimateTokens(text: string, imageCount = 0): number {
  return estimateSync(text, imageCount)
}
