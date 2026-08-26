// ============================================================
// useAuthBootstrap — 认证态生命周期管理（全局仅挂载一次）
// ============================================================
// 职责：
//   1. 启动时从主进程恢复持久化 token，并驱动状态机 idle -> loading/anonymous
//   2. token 有效则拉取用户资料，区分「鉴权失败」与「网络故障」分别处理
//   3. 订阅 token 变化：被动登出（refresh 失败等）时自动重置为 anonymous
//
// 放在 App 顶层调用，取代原先分散在 App.tsx 与 Sidebar.tsx 的手动搬运逻辑。
//
// StrictMode 兼容性：使用 useState 而非 useRef 守护一次性初始化。
// useRef 跨「mount → unmount → mount」周期存活，会导致 React 18 StrictMode
// 第二次挂载时直接跳过副作用，反而把第一次未跑完的引导困在原地；
// useState 在每次 mount 都重置，配合 effect 清理函数可保证副作用最多跑一次。
// 即便首次异步流程因异常中断，最终态（anonymous）也一定会被写入。

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { apiClient } from '@/services/api'
import { authService } from '@/services/api/auth'
import { storeApi } from '@/services/ipc'
import type { AuthTokens } from '@shared/types'
import { useChatStore } from '@/stores/chatStore'
import {
  authStatusAtom,
  authErrorAtom,
  currentUserAtom,
  cachedUserAtom,
  ANONYMOUS_USER,
  LOCAL_USER,
  toAppUser,
  isAuthFailure,
  toErrorMessage
} from '@/stores/authStore'
import { isLocalRuntimeActive } from '@/services/localChat'

const TOKEN_STORAGE_KEY = 'auth.tokens'

/** 把状态机推进到确定态（未登录），用于任何「兜底」路径 */
function enterAnonymous(
  setUser: (u: typeof ANONYMOUS_USER) => void,
  setCachedUser: (u: typeof ANONYMOUS_USER | null) => void,
  setStatus: (s: 'anonymous') => void,
  setError: (e: null) => void
): void {
  // 云边双模阶段 2：本地运行时激活时免登录——以本地单用户档案展示，
  // 状态机仍为 anonymous（登录入口保留，可随时切换云端账号）。
  setUser(isLocalRuntimeActive() ? LOCAL_USER : ANONYMOUS_USER)
  setCachedUser(null)
  setStatus('anonymous')
  setError(null)
}

export function useAuthBootstrap() {
  const setStatus = useSetAtom(authStatusAtom)
  const setError = useSetAtom(authErrorAtom)
  const setUser = useSetAtom(currentUserAtom)
  const setCachedUser = useSetAtom(cachedUserAtom)

  // 拉取资料
  const loadProfile = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const profile = await authService.getProfile()
      const appUser = toAppUser(profile)
      setUser(appUser)
      setCachedUser(appUser)
      setStatus('authed')
    } catch (err) {
      if (isAuthFailure(err)) {
        // 鉴权失败：token 已不可用（过期/被撤销/用户被删）。
        // 必须清除缓存，否则冷启动会展示一个实际已登出的用户，比空白更具误导性。
        enterAnonymous(setUser, setCachedUser, setStatus, setError)
        apiClient.clearTokens()
      } else {
        // 网络/后端故障：token 可能仍有效，保留缓存，标记为可重试
        setStatus('error')
        setError(toErrorMessage(err))
      }
    }
  }, [setStatus, setError, setUser, setCachedUser])

  // 桥接：认证态 -> 会话列表生命周期。
  // 解决「登出后上一个账号的会话列表残留」问题：会话数据严格按 userId 隔离，
  // 但前端登出只清 token、不清 useChatStore.sessions，导致列表残留。
  // 此处监听 authStatusAtom 跳变：
  //   - 进入 anonymous / error：清空会话（登出或鉴权失败，旧列表失效）
  //   - 进入 authed：若列表为空则重新拉取（覆盖「切换账号」场景）
  // 用 prevStatus ref 仅在真实跳变时执行，避免 StrictMode 双挂载重复触发、
  // 也避免初始 idle 阶段无谓清空。resetSessions 只清数据字段，不碰流式/业务 action。
  const status = useAtomValue(authStatusAtom)
  const prevStatus = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = status
    if (prev === null || prev === status) return // 跳过首次挂载与无变化

    const chat = useChatStore.getState()
    if (status === 'anonymous' || status === 'error') {
      chat.resetSessions()
    } else if (status === 'authed') {
      // 仅当列表为空时拉取，避免覆盖已加载的会话、保持幂等。
      // 切号场景：上一账号已 resetSessions（sessions 为空），此处会以新 token 重新拉取。
      if (chat.sessions.length === 0) {
        void chat.loadSessions()
      }
    }
  }, [status])

  // 「正在引导」标记：useState 每次 mount 重置，StrictMode 安全。
  // 关键修复：守卫失败（被中断）也必须把状态机推进到确定态，否则
  // authStatusAtom 永远停在 idle，UI 永远走骨架屏分支，导致整个底部菜单看似消失。
  const [bootstrapping, setBootstrapping] = useState(false)

  useEffect(() => {
    if (bootstrapping) return
    setBootstrapping(true)

    // 订阅 token 变化（多订阅者模式，不会覆盖持久化订阅）。
    const unsubscribe = apiClient.onTokensChange((tokens) => {
      if (!tokens) {
        enterAnonymous(setUser, setCachedUser, setStatus, setError)
      }
    })

    // 持久化订阅
    const unsubscribePersist = apiClient.onTokensChange((tokens) => {
      if (tokens) {
        void storeApi.set(TOKEN_STORAGE_KEY, tokens)
      } else {
        void storeApi.delete(TOKEN_STORAGE_KEY)
      }
    })

    // 主流程：任何异常路径都必须落到 enterAnonymous（最终态），
    // 杜绝 unhandled rejection 让 UI 永远停在 idle。
    void (async () => {
      try {
        const restored = await apiClient.restoreTokens(async () => {
          const tokens = await storeApi.get<AuthTokens | null>(TOKEN_STORAGE_KEY)
          return tokens ?? null
        })

        if (restored) {
          await loadProfile()
        } else {
          // 确无 token：明确置为未登录，并清掉可能残留的陈旧缓存
          enterAnonymous(setUser, setCachedUser, setStatus, setError)
        }
      } catch (err) {
        // 引导失败（IPC 异常、storeApi 异常等）：保证 UI 不会卡在 idle。
        console.error('[auth] bootstrap failed:', err)
        enterAnonymous(setUser, setCachedUser, setStatus, setError)
      }
    })()

    return () => {
      unsubscribe()
      unsubscribePersist()
    }
    // loadProfile 已在自身 useCallback 中稳定；只挂载一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { retry: loadProfile }
}