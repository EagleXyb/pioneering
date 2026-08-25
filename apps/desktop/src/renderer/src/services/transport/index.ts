// ============================================================
// Transport Provider — Agent 流式通道的选择入口（云边双模阶段 0/1）
//
// 阶段 0：只注册 HttpTransport，行为与改造前完全一致。
// 阶段 1：新增 IpcTransport，由 TRANSPORT_MODE 特性开关选择：
//
//   解析优先级（高 → 低）：
//     1. localStorage['agent.transportMode']（运行时切换，下次启动保留）
//     2. 构建时环境变量 VITE_AGENT_TRANSPORT（'http' | 'ipc'）
//     3. 默认 'http'（安全默认：阶段 1 验收通过前不改变线上行为）
//
//   运行时守卫：模式为 ipc 但 preload agent API 不可用
//   （纯浏览器 dev / 单测环境）时自动回退 http 并告警一次。
//
//   控制台切换：window.__setAgentTransportMode('ipc' | 'http')
// ============================================================

import { httpTransport } from './http-transport'
import { ipcTransport } from './ipc-transport'
import type { AgentTransport } from './types'

export type AgentTransportMode = 'http' | 'ipc'

const STORAGE_KEY = 'agent.transportMode'

function readStoredMode(): AgentTransportMode | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'http' || v === 'ipc' ? v : null
  } catch {
    return null
  }
}

function readEnvMode(): AgentTransportMode | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env
  const v = env?.VITE_AGENT_TRANSPORT
  return v === 'http' || v === 'ipc' ? v : null
}

function resolveInitialMode(): AgentTransportMode {
  return readStoredMode() ?? readEnvMode() ?? 'http'
}

function isIpcAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.api?.agent
}

let warnedIpcUnavailable = false

function selectTransport(mode: AgentTransportMode): AgentTransport {
  if (mode === 'ipc') {
    if (isIpcAvailable()) return ipcTransport
    if (!warnedIpcUnavailable) {
      warnedIpcUnavailable = true
      console.warn(
        '[transport] TRANSPORT_MODE=ipc 但 preload agent API 不可用，回退 http'
      )
    }
    return httpTransport
  }
  return httpTransport
}

let currentMode: AgentTransportMode = resolveInitialMode()
let currentTransport: AgentTransport = selectTransport(currentMode)

/** 获取当前激活的 Agent 传输通道（chatStore / hitlStore 统一入口） */
export function getAgentTransport(): AgentTransport {
  // 延迟重检：模块加载早于 preload 注入完成（HMR/测试）时自动修正
  if (currentMode === 'ipc' && currentTransport.kind === 'http' && isIpcAvailable()) {
    currentTransport = ipcTransport
  }
  return currentTransport
}

/** 当前传输模式（日志与设置页展示用） */
export function getAgentTransportMode(): AgentTransportMode {
  return currentMode
}

/**
 * 运行时切换传输模式并持久化到 localStorage。
 * 阶段 2 的「云端 / 本地」UI 切换将调用本函数。
 */
export function setAgentTransportMode(mode: AgentTransportMode): void {
  currentMode = mode
  currentTransport = selectTransport(mode)
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // 持久化失败不影响本次切换
  }
}

/** 切换传输通道（测试注入用；阶段 0 起保留） */
export function setAgentTransport(transport: AgentTransport): void {
  currentTransport = transport
}

export type { AgentTransport, AgentTransportKind } from './types'
export { httpTransport } from './http-transport'
export { ipcTransport } from './ipc-transport'
