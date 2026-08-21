// 对应 Python: orchestration/__init__.py
// orchestration 模块统一导出
//
// 协议演进（对应文档 §2.2）：透传 communication 子包的新增导出
export { EventBus, PersistentEventLog, get_event_bus, reset_event_bus, override_event_bus } from './communication/message-bus.js'
export type { EventHandler, PersistentEventLogOptions } from './communication/message-bus.js'
export {
  EventBusBackend,
  create_distributed_event_bus,
  type DistributedEventBusOptions,
  type RedisEventBusConfig,
} from './communication/event-bus-adapter.js'
export {
  AgentEvent,
  AGENT_EVENT_SCHEMA_VERSION,
  ErrorCode,
  EventAction,
  EventDomain,
  EventPriority,
  LLMRequest,
  LLMResponse,
  MemoryQueryRequest,
  MemoryQueryResponse,
  PerceptionInput,
  ToolCallRequest,
  ToolCallResponse,
} from './communication/protocol.js'
export type { AgentEventInit } from './communication/protocol.js'
export { SensorManager } from './sensor-manager.js'
export {
  AGUIStreamAdapter,
  AGUIStateMachine,
  AGUIEventType,
  AGUIEncoder,
  type UserQuestionRequestPayload,
} from './communication/agui-adapter.js'
export { SSEEncoder, StreamPublisher } from './communication/streaming.js'
export {
  ConsensusPattern,
  ConsensusStrategy,
  MajorityVoteStrategy,
  WeightedAggregateStrategy,
  LLMJudgeStrategy,
  create_consensus_strategy,
} from './patterns/consensus.js'
export { DelegationPattern } from './patterns/delegation.js'
