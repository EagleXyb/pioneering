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

/** 支持的传输方式（与后端 ALLOWED_TRANSPORTS 一致，ws 为 websocket 别名） */
export type McpTransport =
  | 'stdio'
  | 'sse'
  | 'streamable_http'
  | 'websocket';

/** 「添加插件」请求体：stdio 走 command/args/env/cwd，网络传输走 url */
export interface AddMcpServerInput {
  /** 插件（MCP server）名称，字母/数字/点/下划线/连字符，需唯一 */
  name: string;
  transport: McpTransport;
  /** stdio：启动命令（如 npx / node / uvx） */
  command?: string;
  /** stdio：命令参数（逐项传递，不做 shell 解析） */
  args?: string[];
  /** stdio：工作目录（可选） */
  cwd?: string;
  /** stdio：环境变量键值对（可选） */
  env?: Record<string, string>;
  /** sse / streamable_http / websocket：服务地址 */
  url?: string;
  /** 添加后立即连接（默认 true；false 时仅写入配置） */
  autoStart?: boolean;
}

export interface AddMcpServerResponse {
  server: McpServerStatus;
  /** 配置已写入但立即连接失败时的错误信息（缺失表示连接成功或未尝试连接） */
  connectError?: string;
}

/** 获取已配置的 MCP servers 及连接状态 */
export function getMcpServers(): Promise<McpServersResponse> {
  return get<McpServersResponse>('/mcp/servers');
}

/** 新增一个 MCP server（插件）配置，默认立即尝试连接 */
export function addMcpServer(
  input: AddMcpServerInput,
): Promise<AddMcpServerResponse> {
  return post<AddMcpServerResponse>('/mcp/servers', input);
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
