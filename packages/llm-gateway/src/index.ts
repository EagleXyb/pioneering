// llm-gateway：接入层装配
//
// 依赖方向：gateway → core / adapters → contracts。
// 宿主只与 gateway 交互，不直接接触适配器与策略。
export {
  LLMGateway,
  createLLMGateway,
  type ChatAdapter,
  type CapabilitiesResponse,
  type CapabilityModel,
  type GatewayPolicy,
  type LLMGatewayOptions,
  type ProviderConfig,
} from './gateway.js'
