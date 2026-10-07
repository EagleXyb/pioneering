/**
 * MCP 管理 API（T5.1 / T5.2）
 */
import { get, post, put } from './client';

export interface McpToolBrief {
  name: string;
  description: string;
}

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  transport: string;
  connected: boolean;
  toolCount: number;
  tools: McpToolBrief[];
}

export interface McpServersResponse {
  servers: McpServerStatus[];
  total: number;
}

export interface McpPolicy {
  hitlEnabled: boolean;
  sensitiveTools: string[];
}

/** 获取已配置的 MCP servers 及连接状态 */
export function getMcpServers(): Promise<McpServersResponse> {
  return get<McpServersResponse>('/mcp/servers');
}

/** 连接指定 MCP server */
export function startMcpServer(
  name: string,
): Promise<{ name: string; connected: boolean; toolCount: number }> {
  return post(`/mcp/servers/${encodeURIComponent(name)}/start`);
}

/** 断开指定 MCP server */
export function stopMcpServer(
  name: string,
): Promise<{ name: string; connected: boolean }> {
  return post(`/mcp/servers/${encodeURIComponent(name)}/stop`);
}

/** 查看工具审批策略 */
export function getMcpPolicy(): Promise<McpPolicy> {
  return get<McpPolicy>('/mcp/policy');
}

/** 更新工具审批策略（敏感工具名单 / HITL 开关） */
export function updateMcpPolicy(body: Partial<McpPolicy>): Promise<McpPolicy> {
  return put<McpPolicy>('/mcp/policy', body);
}
