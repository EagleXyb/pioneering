// ============================================================
// hitl-bridge — chatStore → hitlStore 的单向桥接（T8 修复）
//
// 背景：chatStore 与 hitlStore 曾在模块顶层互相 import
// （chatStore.ts ↔ hitlStore.ts），形成 ESM 环依赖，仅靠模块
// 初始化时序侥幸可用。本桥切断 chatStore → hitlStore 的静态边：
//   - chatStore 只依赖本桥（叶子模块，不反向依赖任何 store）；
//   - hitlStore 在模块求值时调用 bindHitlStore 自注册；
//   - hitlStore → chatStore 的静态边保留（单向，无环）。
//
// 时序保证：所有 getHitlStore() 调用都发生在用户交互/流回调中
//（晚于全部模块求值）；若在未接线时被调用，显式抛错而非返回 undefined。
// ============================================================

import type { useHitlStore } from './hitlStore'

export type HitlStoreApi = typeof useHitlStore

let boundStore: HitlStoreApi | null = null

/** hitlStore 模块求值时自注册（唯一接线点） */
export function bindHitlStore(store: HitlStoreApi): void {
  boundStore = store
}

/** 获取已接线的 hitlStore（动作回调中使用；未接线时抛错暴露初始化问题） */
export function getHitlStore(): HitlStoreApi {
  if (!boundStore) {
    throw new Error('[hitl-bridge] hitlStore 尚未接线（bindHitlStore 未被调用）')
  }
  return boundStore
}
