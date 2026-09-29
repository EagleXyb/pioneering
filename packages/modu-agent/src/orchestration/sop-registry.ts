// sop-registry.ts
//
// P3-C：SOP「角色字典 + 步骤类型字典」—— 取代硬编码集合。
//
// 设计要点：
//   1. Supervisor 角色集合（research/coding/review 等）与 Plan-Execute 步骤类型
//      （reasoning/tool_use/delegation）均为**可注册字典**：场景包经
//      ScenarioHost 追加，无需改框架源码；
//   2. 内置三项作为默认基线，与改造前行为一致；
//   3. 查找失败/未注册时回退默认集合（零行为漂移）；
//   4. 注册表为进程内单例（与 ComponentRegistry 同范式），reset 供测试隔离。

/** 默认 Supervisor 角色（与 subgraph/supervisor.ts _DEFAULT_TASK_TYPES 一致）。 */
const DEFAULT_SOP_ROLES: readonly string[] = ['research', 'coding', 'review']

/** 默认 Plan-Execute 步骤类型（与 plan-execute/types.ts 枚举一致）。 */
const DEFAULT_PLAN_TASK_TYPES: readonly string[] = ['reasoning', 'tool_use', 'delegation']

/** Supervisor 角色字典（保持插入顺序）。 */
const _sopRoles: Set<string> = new Set(DEFAULT_SOP_ROLES)

/** Plan-Execute 步骤类型字典。 */
const _planTaskTypes: Set<string> = new Set(DEFAULT_PLAN_TASK_TYPES)

/** 注册 Supervisor 角色（幂等）。 */
export function registerSopRole(role: string): void {
  if (!role || typeof role !== 'string') throw new Error('SOP role must be a non-empty string')
  _sopRoles.add(role)
}

/** 批量注册 Supervisor 角色。 */
export function registerSopRoles(roles: readonly string[]): void {
  for (const r of roles) registerSopRole(r)
}

/** 判断角色是否已注册。 */
export function isRegisteredSopRole(role: string): boolean {
  return _sopRoles.has(role)
}

/** 移除 Supervisor 角色（内置角色亦可移除，由调用方保证语义；不存在返回 false）。 */
export function unregisterSopRole(role: string): boolean {
  return _sopRoles.delete(role)
}

/** 列出已注册角色（默认全集；空时回退内置）。 */
export function listSopRoles(): string[] {
  const out = [..._sopRoles]
  return out.length > 0 ? out : [...DEFAULT_SOP_ROLES]
}

/** 注册 Plan-Execute 步骤类型（幂等）。 */
export function registerPlanTaskType(type: string): void {
  if (!type || typeof type !== 'string') throw new Error('plan task type must be a non-empty string')
  _planTaskTypes.add(type)
}

/** 批量注册 Plan-Execute 步骤类型。 */
export function registerPlanTaskTypes(types: readonly string[]): void {
  for (const t of types) registerPlanTaskType(t)
}

/** 移除 Plan-Execute 步骤类型；不存在返回 false。 */
export function unregisterPlanTaskType(type: string): boolean {
  return _planTaskTypes.delete(type)
}

/** 判断步骤类型是否已注册。 */
export function isRegisteredPlanTaskType(type: string): boolean {
  return _planTaskTypes.has(type)
}

/** 列出已注册步骤类型。 */
export function listPlanTaskTypes(): string[] {
  return [..._planTaskTypes]
}

/** 重置为内置字典（测试隔离用）。 */
export function resetSopRegistry(): void {
  _sopRoles.clear()
  for (const r of DEFAULT_SOP_ROLES) _sopRoles.add(r)
  _planTaskTypes.clear()
  for (const t of DEFAULT_PLAN_TASK_TYPES) _planTaskTypes.add(t)
}
