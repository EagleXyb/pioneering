// llm-adapters：协议适配层
//
// 每个适配器只关心「如何与某类上游协议对话」，不感知模型目录、策略与计费。
export {
  OpenAICompatibleAdapter,
  createOpenAICompatibleAdapter,
  type OpenAICompatibleConfig,
} from './openai-compatible.js'
export { parseSSEDataLine, splitSSEBuffer } from './sse.js'
