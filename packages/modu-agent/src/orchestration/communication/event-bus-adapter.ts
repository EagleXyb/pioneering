// 对应文档 §2.2 建议3：跨进程 EventBus 适配器接口
//
// 现状：EventBus 仅内存实现，无跨进程 pub/sub，分布式部署下多实例间事件不互通。
// 本文件定义跨进程适配器的标准接口与配置，具体实现（Redis pub/sub、NATS 等）
// 由部署方按需引入，避免在核心包中强制依赖 Redis 客户端。
//
// 使用方式：
//   1. 部署方实现 EventBusBackend 接口（如 RedisEventBusBackend）
//   2. 通过 create_distributed_event_bus(backend) 包装本地 EventBus
//   3. publish 时本地分发 + 远端广播；远端消息通过 backend.subscribe 回流到本地

import type { AgentEvent } from './protocol.js'
import type { EventBus } from './message-bus.js'

/**
 * 跨进程 EventBus 后端接口。
 *
 * 实现方需提供 publish（广播到远端）与 subscribe（接收远端消息）能力，
 * 内部传输协议由实现方决定（Redis pub/sub、NATS、Kafka 等）。
 */
export interface EventBusBackend {
  /** 广播事件到远端 */
  publish(event: AgentEvent): Promise<void>

  /**
   * 订阅远端事件。
   * @param handler 远端事件到达时调用；实现方需保证 handler 异常不影响订阅
   * @returns 取消订阅函数
   */
  subscribe(handler: (event: AgentEvent) => Promise<void> | void): () => void

  /** 关闭后端连接，释放资源 */
  close(): Promise<void>
}

/**
 * 分布式 EventBus 配置。
 */
export interface DistributedEventBusOptions {
  /** 本地 EventBus 实例（默认 get_event_bus()） */
  local_bus?: EventBus
  /** 跨进程后端实现 */
  backend: EventBusBackend
  /**
   * 是否将远端事件重新发布到本地总线。
   * 默认 true，使本地订阅者也能收到远端事件。
   */
  replay_remote_to_local?: boolean
  /**
   * 是否将本地事件广播到远端。
   * 默认 true。
   */
  broadcast_local_to_remote?: boolean
}

/**
 * 创建分布式 EventBus 包装器。
 *
 * 包装后：
 *   - 本地 publish 会同时分发到本地订阅者与远端后端
 *   - 远端事件通过 backend.subscribe 到达后，可选重新发布到本地总线
 *
 * 注意：返回的对象不是 EventBus 子类，而是实现相同 publish 接口的轻量包装器，
 *       用于显式区分本地与分布式调用路径。如需替换全局 event_bus，
 *       请通过 override_event_bus 包装。
 *
 * @param opts 配置
 * @returns 带 close() 方法的分布式总线包装器
 */
export function create_distributed_event_bus(
  opts: DistributedEventBusOptions,
): {
  publish: (event: AgentEvent) => Promise<void>
  close: () => Promise<void>
} {
  const localBus = opts.local_bus
  const backend = opts.backend
  const replayRemote = opts.replay_remote_to_local ?? true
  const broadcastLocal = opts.broadcast_local_to_remote ?? true

  // 远端事件回流到本地
  if (replayRemote && localBus) {
    backend.subscribe(async (event) => {
      try {
        await localBus.publish(event)
      } catch (e) {
        console.warn('[distributed-event-bus] replay remote event failed:', String(e))
      }
    })
  }

  return {
    async publish(event: AgentEvent): Promise<void> {
      // 本地分发
      if (localBus) {
        await localBus.publish(event)
      }
      // 远端广播（失败不阻塞本地分发结果）
      if (broadcastLocal) {
        try {
          await backend.publish(event)
        } catch (e) {
          console.warn('[distributed-event-bus] remote broadcast failed:', String(e))
        }
      }
    },
    async close(): Promise<void> {
      await backend.close()
    },
  }
}

/**
 * Redis EventBus 后端配置（参考实现，需部署方提供 redis 客户端）。
 *
 * 实现示例（伪代码）：
 * ```ts
 * import { createClient } from 'redis'
 * import { EventBusBackend } from './event-bus-adapter.js'
 *
 * export async function create_redis_backend(
 *   url: string,
 *   channel: string = 'modu-agent-events',
 * ): Promise<EventBusBackend> {
 *   const publisher = createClient({ url })
 *   const subscriber = createClient({ url })
 *   await publisher.connect()
 *   await subscriber.connect()
 *   const handlers = new Set<(e: AgentEvent) => void>()
 *   await subscriber.subscribe(channel, (msg) => {
 *     try {
 *       const dict = JSON.parse(msg)
 *       const event = AgentEvent.fromDict(dict)
 *       for (const h of handlers) h(event)
 *     } catch (e) { /* ignore *\/ }
 *   })
 *   return {
 *     async publish(event) {
 *       await publisher.publish(channel, JSON.stringify(event.toDict()))
 *     },
 *     subscribe(handler) {
 *       handlers.add(handler)
 *       return () => handlers.delete(handler)
 *     },
 *     async close() {
 *       await publisher.quit()
 *       await subscriber.quit()
 *     },
 *   }
 * }
 * ```
 *
 * 上述实现未在核心包中实例化，避免强制引入 redis 依赖。
 * 部署方按需复制上述模板并引入 `redis` 包即可。
 */
export interface RedisEventBusConfig {
  /** Redis 连接 URL，如 redis://localhost:6379 */
  url: string
  /** pub/sub 频道名，默认 'modu-agent-events' */
  channel?: string
  /** 可选密码 */
  password?: string
  /** 连接超时（毫秒） */
  connect_timeout_ms?: number
}
