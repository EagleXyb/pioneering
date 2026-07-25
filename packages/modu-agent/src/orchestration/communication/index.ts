// 对应 Python: orchestration/communication/__init__.py
// communication 模块统一导出
//
// 协议演进（对应文档 §2.2 建议 1/2/3/4/5）：
//   - AgentEvent 新增泛型 / schema_version / payloadAsBytes / payloadAsString
//   - metadata 类型放宽为 Record<string, unknown>
//   - PersistentEventLog 支持 event_ttl_ms 配置
//   - 新增跨进程 EventBus 适配器接口（EventBusBackend / create_distributed_event_bus）
export { EventBus, PersistentEventLog, Subscription, get_event_bus, reset_event_bus, override_event_bus } from './message-bus.js'
export type { EventHandler, PersistentEventLogOptions } from './message-bus.js'
export {
  EventBusBackend,
  create_distributed_event_bus,
  type DistributedEventBusOptions,
  type RedisEventBusConfig,
} from './event-bus-adapter.js'
export {
  AGUIEventType,
  AGUIEncoder,
  AGUIStateMachine,
  AGUIStreamAdapter,
  AGUIMessagesSnapshot,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ThinkingStartEvent,
  ThinkingContentEvent,
  ThinkingEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  ToolCallRecord,
  encode_thinking_block,
} from './agui-adapter.js'
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
} from './protocol.js'
export type { AgentEventInit } from './protocol.js'
export { SSEEncoder, StreamPublisher } from './streaming.js'
export type { SSEFrame } from './streaming.js'
