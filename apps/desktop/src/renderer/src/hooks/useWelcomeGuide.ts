// ============================================================
// useWelcomeGuide — 首次使用 / 版本更新引导（预留接口）
// ============================================================
// 后续迭代时在 WelcomeScreen 中接入：
//   const { showOnboarding, showChangelog } = useWelcomeGuide(APP_VERSION)
// 当前暂不引用，仅提供骨架供后续迭代使用。
// ============================================================

import { useState, useEffect } from 'react'

const VERSION_KEY = 'app.lastVersion'

export interface WelcomeGuideState {
  /** 首次使用（本地无版本记录） */
  showOnboarding: boolean
  /** 版本更新（本地版本与当前不一致） */
  showChangelog: boolean
  /** 关闭首次引导 */
  closeOnboarding: () => void
  /** 关闭更新日志 */
  closeChangelog: () => void
}

export function useWelcomeGuide(currentVersion: string): WelcomeGuideState {
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showChangelog, setShowChangelog] = useState(false)

  useEffect(() => {
    const last = localStorage.getItem(VERSION_KEY)
    if (!last) {
      setShowOnboarding(true)
    } else if (last !== currentVersion) {
      setShowChangelog(true)
    }
    localStorage.setItem(VERSION_KEY, currentVersion)
  }, [currentVersion])

  return {
    showOnboarding,
    showChangelog,
    closeOnboarding: () => setShowOnboarding(false),
    closeChangelog: () => setShowChangelog(false)
  }
}
