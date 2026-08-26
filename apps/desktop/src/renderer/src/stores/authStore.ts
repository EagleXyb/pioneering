// ============================================================
// Auth Store — 统一的认证态数据源
// ============================================================
// 背景：认证态原先散落在三处且互不同步——
//   1. electron-store（磁盘持久层，经 IPC 读写）
//   2. ApiClient.accessToken（内存，唯一「是否已登录」判据）
//   3. userAtom（Jotai 内存，唯一 UI 数据源，无持久化）
// 三者之间没有订阅关系，全靠组件在某个时机手动搬运，导致冷启动竞态、
// 登录后不刷新、失败被静默吞掉等一系列「账户菜单时有时无」的问题。
//
// 本 store 将 status + user 收敛为单一响应式数据源：
//   - 订阅 apiClient 的 token 变化，token 被清空时自动重置为未登录
//   - 用户资料带 localStorage 缓存，冷启动先渲染缓存值消除闪烁
//   - 明确区分「鉴权失败」与「网络故障」：前者清缓存登出，后者保留缓存待重试

import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { UserProfile } from '@shared/types'
import type { AppUser } from './atoms'

/**
 * 认证状态机：
 *  - idle      : token 尚未从持久层恢复，无法判断登录态（应展示骨架屏）
 *  - loading   : 已有 token，正在拉取用户资料
 *  - authed    : 已登录且拿到用户资料
 *  - anonymous : 确定未登录（无 token / token 失效 / 已登出）
 *  - error     : 有 token 但资料拉取失败（多为后端不可用），可重试
 */
export type AuthStatus = 'idle' | 'loading' | 'authed' | 'anonymous' | 'error'

/** 未登录时的占位用户，供各处复用，避免重复字面量 */
export const ANONYMOUS_USER: AppUser = {
  id: '',
  username: '未登录',
  nickname: null,
  email: null,
  avatar: null
}

/**
 * 云边双模阶段 2：本地单用户档案。
 * 本地模式（IPC Transport + 本地 SQLite DAO）免登录即完整可用；
 * 无云端 token 时以该档案展示，登录云端后仍可切换为真实账号。
 */
export const LOCAL_USER: AppUser = {
  id: 'local_user',
  username: '本地用户',
  nickname: null,
  email: null,
  avatar: null
}

/** 后端 UserProfile -> 前端 AppUser 的统一映射，避免各调用点各写一遍 */
export function toAppUser(profile: UserProfile): AppUser {
  return {
    id: profile.id,
    username: profile.username,
    nickname: profile.nickname ?? null,
    email: profile.email ?? null,
    avatar: profile.avatar ?? null
  }
}

/**
 * 用户资料缓存（localStorage）。
 * 仅用于冷启动期间的占位渲染，消除「未登录 -> 用户名」的闪烁。
 *
 * 注意：这是可能过期的数据（token 失效、用户被删、别处登出等），
 * 因此它绝不能单独作为「已登录」的判据——真正的判据是 authStatusAtom。
 * 一旦 getProfile 明确返回 401/403，必须调用 clearCachedUser 清除。
 */
export const cachedUserAtom = atomWithStorage<AppUser | null>('auth-cached-user', null)

/** 认证状态机当前值 */
export const authStatusAtom = atom<AuthStatus>('idle')

/** 资料拉取失败时的错误信息，供 UI 展示与重试提示 */
export const authErrorAtom = atom<string | null>(null)

/**
 * 当前用户（派生）。
 * authed 时返回真实用户；idle/loading 时回落到缓存值做占位；
 * 其余情况一律返回未登录占位，确保「登出后不会残留旧用户名」。
 */
export const currentUserAtom = atom<AppUser>(ANONYMOUS_USER)

/**
 * 供 UI 使用的聚合视图：一次取齐三态判断所需的全部信息。
 */
export const authViewAtom = atom((get) => {
  const status = get(authStatusAtom)
  const user = get(currentUserAtom)
  const cached = get(cachedUserAtom)

  // idle/loading 期间用缓存占位，避免闪烁；缓存缺失则视为骨架屏状态
  const isSettling = status === 'idle' || status === 'loading'
  const displayUser = status === 'authed' ? user : isSettling && cached ? cached : ANONYMOUS_USER

  return {
    status,
    user: displayUser,
    /** 是否已确认登录（仅此判据可用于展示账户信息 / 允许登出） */
    isAuthed: status === 'authed',
    /** 是否处于未定态：展示骨架屏而非「未登录」，防止误导 */
    isSettling,
    /** 是否确定未登录：可展示「点击登录」入口 */
    isAnonymous: status === 'anonymous',
    /** 是否为可重试的错误态 */
    isError: status === 'error',
    /** 冷启动占位期间，展示的是可能过期的缓存数据 */
    isStale: isSettling && !!cached,
    error: get(authErrorAtom)
  }
})

/** 判断一个请求错误是否属于「鉴权失败」（需要登出并清缓存） */
export function isAuthFailure(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  return status === 401 || status === 403
}

/** 提取可读的错误信息 */
export function toErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const res = (err as { response?: { data?: { message?: string } } }).response
    if (res?.data?.message) return res.data.message
  }
  if (err instanceof Error) return err.message
  return '未知错误'
}
