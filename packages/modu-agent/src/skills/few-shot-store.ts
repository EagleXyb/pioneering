// P0（FS-2 / FS-3）：Few-shot 示例库的进程级单例。
//
// 为什么需要单例：
//   - `createFewShotSelector()` 每次建图都会执行，若每次 new 一个空库，
//     "种子示例"与"反馈入池"会分散在不同实例里，端到端仍然恒空；
//   - 反馈生产方（feedback / memory_update）与选择器需要共享同一个库；
//   - 测试可通过 `resetFewShotStore()` 隔离状态。
//
// 边界：
//   - 本模块不 import graph/nodes，避免循环依赖；
//   - 库为空/异常时上层静默跳过，不改变既有运行路径。

import {
  InMemoryExampleStore,
  type ExampleStore,
  type FewShotExample,
} from './few-shot-selector.js'
import { FEW_SHOT_SEEDS } from './few-shot-seeds.js'

let _sharedStore: ExampleStore | null = null
let _seeded = false

function _createStore(): ExampleStore {
  // 种子示例无 created_at → 由 TTL 逻辑视为"不老化"，避免安装即过期。
  return new InMemoryExampleStore(FEW_SHOT_SEEDS, { maxAgeDays: null })
}

/**
 * 获取进程级共享示例库（首次访问时用种子示例初始化）。
 */
export function getSharedFewShotStore(): ExampleStore {
  if (_sharedStore === null) {
    _sharedStore = _createStore()
    _seeded = true
  }
  return _sharedStore
}

/** 替换共享库（供测试/宿主注入自定义 store）。 */
export function setSharedFewShotStore(store: ExampleStore | null): void {
  _sharedStore = store
  _seeded = store !== null
}

/** 重置共享库（测试隔离用）。 */
export function resetFewShotStore(): void {
  _sharedStore = null
  _seeded = false
}

/** 共享库是否已装载种子（供验收断言）。 */
export function isFewShotStoreSeeded(): boolean {
  return _seeded
}

/**
 * 记录一条候选示例（FS-3）。
 *
 * 生产方应在满足以下条件时调用：
 *   - 质量分 ≥ 阈值（由调用方判断）；
 *   - 输出不含 PII / 密钥（由调用方或上层脱敏）；
 *   - 同一输入未被记录过（store 内部按 input 去重）。
 *
 * 任何异常都被吞掉：示例沉淀失败不得影响主流程。
 */
export async function recordFewShotExample(example: FewShotExample): Promise<boolean> {
  try {
    if (!example || !example.id || !example.input || !example.output) return false
    return await getSharedFewShotStore().add({
      ...example,
      created_at: example.created_at ?? Date.now(),
      source: example.source ?? 'feedback',
      version: example.version ?? '1',
    })
  } catch {
    return false
  }
}

/**
 * 从一条完成的对话构造候选示例（保守版）。
 *
 * 仅用于"高分 run 入池"：截断输入/输出，避免把整段会话写进示例库。
 */
export function buildCandidateFromRun(params: {
  id: string
  input: string
  output: string
  domain?: string
  qualityScore: number
  maxChars?: number
}): FewShotExample {
  const maxChars = params.maxChars ?? 2000
  return {
    id: params.id,
    input: String(params.input ?? '').slice(0, maxChars),
    output: String(params.output ?? '').slice(0, maxChars),
    domain: params.domain,
    quality_score: params.qualityScore,
    source: 'feedback',
    version: '1',
    created_at: Date.now(),
  }
}
