// P1（T-11）：记忆策略统一契约（`MemoryStrategy`）。
//
// 背景（详见 `packages/docs/Agent架构分层解耦实施计划.md` §0.1 #7/#8/#9）：
//   - 运行时存在**两套互不相通**的记忆路径：
//       ① 主链路 = LangGraph `BaseStore`（`ChromaStore` / `InMemoryStoreAdapter`）
//          → `memory_query` / `memory_update` 节点（`graph.ts` / `nodes.ts`）；
//       ② `BaseMemory` 家族（`InMemoryShortTermMemory` / `ChromaLongTermMemory`）
//          —— P0 仅把它注册进 registry，**运行时零消费**；
//   - `ObservationMemory` 零构造零调用，不在此契约的目标范围内（去留见 D-15）。
//
// 本契约把"主链路真在用的 BaseStore 读写"抽象为可注册策略：
//   - `BaseStoreMemoryStrategy`（`src/memory/base-store-strategy.ts`）与既有
//     `store.search([userId,'knowledge'], …)` / `store.put([userId,'history'], …)`
//     **逐字段等价**；
//   - 宿主可通过 `ComponentRegistry.registerMemoryStrategy` 替换记忆后端，
//     而**无需修改 `graph.ts` / `nodes.ts`**（M2「横向可替换」验收之一）。
//
// 硬约束（默认行为零变化）：
//   - 未注册/未接线时节点走原有 `store` 直连路径，行为逐字节不变；
//   - `supports(taskType)` 未命中时的回退顺序由 `ComponentRegistry.resolveMemoryStrategy`
//     定义（任务级命中 → 注册默认 → undefined）。

/**
 * 单条记忆项。
 *
 * `value` 为底层存储的原始记录（BaseStore 路径），用于保证
 * 注入 `state.knowledge` 时与改造前**逐字段等价**；
 * 非 BaseStore 实现可只填充 `content` / `metadata`。
 */
export interface MemoryItem {
  /** 记忆项唯一 id（BaseStore 路径下为记录 key） */
  id: string
  /** 文本内容（用于 prompt 注入） */
  content: string
  /** 结构化元数据 */
  metadata?: Record<string, any>
  /** 相关度得分（可选，由后端决定语义） */
  score?: number
  /** 底层原始记录（可选，BaseStore 路径保留原值） */
  value?: Record<string, any>
}

/** 记忆召回上下文。 */
export interface MemoryRecallContext {
  /** 用户 id（BaseStore 命名空间的一段） */
  userId: string
  /** 任务类型（用于策略筛选） */
  taskType?: string
  /** 会话 id */
  sessionId?: string
  /** 召回条数上限（默认 5，与改造前一致） */
  topK?: number
  /**
   * 命名空间覆盖（BaseStore 路径下为 `[userId, namespace[0]]`）。
   * 默认 `['knowledge']` —— 与改造前 `nodes.ts` 的 `[userId, 'knowledge']` 一致。
   */
  namespace?: string[]
}

/** 记忆持久化上下文。 */
export interface MemoryPersistContext {
  /** 用户 id */
  userId: string
  /** 会话 id */
  sessionId?: string
  /** 任务类型 */
  taskType?: string
  /**
   * 命名空间覆盖。默认 `['history']` —— 与改造前 `nodes.ts` 的 `[userId, 'history']` 一致。
   */
  namespace?: string[]
}

/**
 * 记忆策略。
 *
 * 由 `ComponentRegistry.registerMemoryStrategy` 注册，
 * `resolveMemoryStrategy(taskType)` 解析。
 */
export interface MemoryStrategy {
  /** 策略唯一标识（如 'base_store' / 'cache'） */
  readonly id: string
  /**
   * 该策略是否适用于给定任务类型。
   *
   * 返回 `true` 表示可服务该 taskType；`taskType` 为 `undefined` 时
   * 表示"通用兜底"语义（由解析方决定是否采用）。
   */
  supports(taskType?: string): boolean
  /** 召回记忆 */
  recall(query: string, ctx: MemoryRecallContext): Promise<MemoryItem[]>
  /** 持久化记忆（不存在的实现可做 no-op） */
  persist(items: MemoryItem[], ctx: MemoryPersistContext): Promise<void>
}
