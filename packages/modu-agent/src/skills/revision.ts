// skills/revision.ts
//
// 技能集合版本号（L3-1.2）。
//
// 为什么需要：图是「构建期固化」的——系统提示里的技能目录、绑定到 LLM 的工具集
// 都在 `create_agent` 时确定。管理面「启用 / 停用技能」后，若不换一个缓存键，
// 宿主的图缓存（backend-ts 的 LRU 8~16）会继续复用旧图，表现为「点了启用但没生效」。
//
// 约定：
//   - 只在「技能集合发生增删」时 bump（注册 / 反注册 / 重新扫描）；
//   - 宿主把 `getSkillsRevision()` 纳入自己的图缓存键；
//   - 进程级单调递增，不持久化（重启后技能从配置重建，缓存也随之清空）。

let _revision = 0

/** 当前技能集合版本号（只读）。 */
export function getSkillsRevision(): number {
  return _revision
}

/** 技能集合发生变化时调用，返回新版本号。 */
export function bumpSkillsRevision(): number {
  _revision += 1
  return _revision
}

/** 测试辅助：重置版本号。 */
export function resetSkillsRevision(): void {
  _revision = 0
}
